import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import pg from 'pg';
const { Pool } = pg;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not defined in environment variables. Falling back to insecure default for development.');
}
const SECRET = JWT_SECRET || 'soreco-portal-fallback-secret-2026';
const PORT = 3000;

// Initialize SQLite Database as a highly reliable local fallback
const db = new Database('database.sqlite');

// Create Local SQLite Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    fullName TEXT,
    email TEXT UNIQUE,
    password TEXT,
    accountNumber TEXT,
    role TEXT,
    phoneNumber TEXT,
    address TEXT,
    profileImage TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    consumerId TEXT,
    consumerName TEXT,
    accountNumber TEXT,
    type TEXT,
    category TEXT,
    description TEXT,
    status TEXT,
    isUrgent INTEGER DEFAULT 0,
    evidenceImage TEXT,
    checklist TEXT,
    messages TEXT,
    feedback TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    title TEXT,
    content TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migration: Add isUrgent to tickets if it doesn't exist
try {
  const tableInfo = db.prepare("PRAGMA table_info(tickets)").all() as any[];
  const hasIsUrgent = tableInfo.some(column => column.name === 'isUrgent');
  if (!hasIsUrgent) {
    db.exec("ALTER TABLE tickets ADD COLUMN isUrgent INTEGER DEFAULT 0");
    console.log("Migration: Added isUrgent column to SQLite tickets table");
  }
} catch (e) {
  console.error("Migration error:", e);
}

// Initialize PostgreSQL Pool with SQLite Fallback
let usePostgres = false;
let pgPool: pg.Pool | null = null;

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))) {
  try {
    pgPool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('render.com') || databaseUrl.includes('neon.tech') || databaseUrl.includes('supabase')
        ? { rejectUnauthorized: false }
        : false
    });
    usePostgres = true;
    console.log('Detected valid PostgreSQL DATABASE_URL.');
  } catch (err) {
    console.error('Failed to initialize PostgreSQL pool:', err);
  }
} else if (databaseUrl) {
  console.log('DATABASE_URL is not a valid PostgreSQL connection string (must start with postgres:// or postgresql://). Skipping PostgreSQL initialization.');
} else {
  console.log('No DATABASE_URL environment variable found. All data will be saved to local SQLite file "database.sqlite" (non-persistent on platforms like Render).');
}

// Initialize PostgreSQL Schema
async function initializePostgresSchema() {
  if (!usePostgres || !pgPool) return;
  try {
    // Test the database connection before running schema creation
    await pgPool.query('SELECT 1');
    
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        fullName VARCHAR(255),
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255),
        accountNumber VARCHAR(255),
        role VARCHAR(50),
        phoneNumber VARCHAR(50),
        address TEXT,
        profileImage TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id VARCHAR(255) PRIMARY KEY,
        consumerId VARCHAR(255),
        consumerName VARCHAR(255),
        accountNumber VARCHAR(255),
        type VARCHAR(50),
        category VARCHAR(255),
        description TEXT,
        status VARCHAR(50),
        isUrgent INTEGER DEFAULT 0,
        evidenceImage TEXT,
        checklist TEXT,
        messages TEXT,
        feedback TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id VARCHAR(255) PRIMARY KEY,
        title VARCHAR(255),
        content TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT
      );
    `);
    console.log('PostgreSQL tables verified and initialized successfully.');
  } catch (err) {
    console.error('Error initializing PostgreSQL schema, falling back to SQLite fallback immediately:', err);
    usePostgres = false;
  }
}

// Seed admin and default users in both databases
const seedDatabases = async () => {
  const usersToSeed = [
    {
      id: 'admin-001',
      fullName: 'System Administrator',
      email: 'admin@gov.ph'.toLowerCase(),
      password: 'admin123',
      role: 'admin',
      accountNumber: 'ADMIN-001'
    },
    {
      id: 'admin-002',
      fullName: 'Janry Maligaso',
      email: 'janry.maligaso@sorsu.edu.ph'.toLowerCase(),
      password: 'admin123',
      role: 'admin',
      accountNumber: 'ADMIN-002'
    },
    {
      id: 'consumer-demo-001',
      fullName: 'Demo Consumer',
      email: 'consumer@gov.ph'.toLowerCase(),
      password: 'consumer123',
      role: 'consumer',
      accountNumber: '00-1234-5678'
    }
  ];

  // 1. Seed SQLite
  for (const user of usersToSeed) {
    const hashedPassword = await bcrypt.hash(user.password, 10);
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO users (id, fullName, email, password, role, accountNumber) VALUES (?, ?, ?, ?, ?, ?)');
      stmt.run(user.id, user.fullName, user.email, hashedPassword, user.role, user.accountNumber);
      console.log(`Seeded/Updated SQLite user: ${user.email}`);
    } catch (err: any) {
      console.error(`Error seeding SQLite user ${user.email}:`, err.message);
    }
  }

  const existingAnnouncements = db.prepare('SELECT COUNT(*) as count FROM announcements').get() as any;
  if (existingAnnouncements.count === 0) {
    const announcements = [
      { id: 'ann-1', title: 'Scheduled Maintenance: Bulan Proper', content: 'Power interruption in Bulan Proper on May 20, 2026, from 8:00 AM to 5:00 PM for line upgrading and maintenance. Please plan accordingly.' },
      { id: 'ann-2', title: 'New Payment Channels', content: 'We now accept payments via GCash, PayMaya, and 7-Eleven. Simply use your account number to pay your monthly bills conveniently.' },
      { id: 'ann-3', title: 'Billing Cycle Update', content: 'May 2026 billing statements are now being distributed. You can also view your current balance through our new Digital Consumer Portal.' }
    ];
    const stmt = db.prepare('INSERT INTO announcements (id, title, content) VALUES (?, ?, ?)');
    for (const ann of announcements) {
      stmt.run(ann.id, ann.title, ann.content);
    }
    console.log('Default SQLite announcements seeded');
  }

  // 2. Seed PostgreSQL if active
  if (usePostgres && pgPool) {
    console.log('Seeding PostgreSQL with initial data...');
    for (const user of usersToSeed) {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      try {
        await pgPool.query(`
          INSERT INTO users (id, fullName, email, password, role, accountNumber)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (email) DO UPDATE SET
            password = EXCLUDED.password,
            fullName = EXCLUDED.fullName,
            role = EXCLUDED.role,
            accountNumber = EXCLUDED.accountNumber
        `, [user.id, user.fullName, user.email, hashedPassword, user.role, user.accountNumber]);
        console.log(`Seeded/Updated PostgreSQL user: ${user.email}`);
      } catch (err: any) {
        console.error(`Error seeding PostgreSQL user ${user.email}:`, err.message);
      }
    }

    try {
      const res = await pgPool.query('SELECT COUNT(*) as count FROM announcements');
      const count = parseInt(res.rows[0].count || '0', 10);
      if (count === 0) {
        const announcements = [
          { id: 'ann-1', title: 'Scheduled Maintenance: Bulan Proper', content: 'Power interruption in Bulan Proper on May 20, 2026, from 8:00 AM to 5:00 PM for line upgrading and maintenance. Please plan accordingly.' },
          { id: 'ann-2', title: 'New Payment Channels', content: 'We now accept payments via GCash, PayMaya, and 7-Eleven. Simply use your account number to pay your monthly bills conveniently.' },
          { id: 'ann-3', title: 'Billing Cycle Update', content: 'May 2026 billing statements are now being distributed. You can also view your current balance through our new Digital Consumer Portal.' }
        ];
        for (const ann of announcements) {
          await pgPool.query(
            'INSERT INTO announcements (id, title, content) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
            [ann.id, ann.title, ann.content]
          );
        }
        console.log('Default PostgreSQL announcements seeded');
      }
    } catch (err: any) {
      console.error('Error seeding PostgreSQL announcements:', err.message);
    }
  }
};

// =========================================================================
// Bridged Database Helpers (PostgreSQL Primary with Local SQLite Fallback)
// =========================================================================

// Helpers to map lowercase PostgreSQL folded column names back to camelCase
const mapUserRow = (row: any) => {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.fullname !== undefined ? row.fullname : row.fullName,
    email: row.email,
    password: row.password,
    accountNumber: row.accountnumber !== undefined ? row.accountnumber : row.accountNumber,
    role: row.role,
    phoneNumber: row.phonenumber !== undefined ? row.phonenumber : row.phoneNumber,
    address: row.address,
    profileImage: row.profileimage !== undefined ? row.profileimage : row.profileImage,
    createdAt: row.createdat !== undefined ? row.createdat : row.createdAt
  };
};

const mapTicketRow = (row: any) => {
  if (!row) return null;
  return {
    id: row.id,
    consumerId: row.consumerid !== undefined ? row.consumerid : row.consumerId,
    consumerName: row.consumername !== undefined ? row.consumername : row.consumerName,
    accountNumber: row.accountnumber !== undefined ? row.accountnumber : row.accountNumber,
    type: row.type,
    category: row.category,
    description: row.description,
    status: row.status,
    isUrgent: row.isurgent !== undefined ? (row.isurgent ? 1 : 0) : (row.isUrgent ? 1 : 0),
    evidenceImage: row.evidenceimage !== undefined ? row.evidenceimage : row.evidenceImage,
    checklist: typeof row.checklist === 'string' ? JSON.parse(row.checklist) : (row.checklist || null),
    messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : (row.messages || []),
    feedback: typeof row.feedback === 'string' ? JSON.parse(row.feedback) : (row.feedback || null),
    createdAt: row.createdat !== undefined ? row.createdat : row.createdAt,
    updatedAt: row.updatedat !== undefined ? row.updatedat : row.updatedAt
  };
};

// Users Helpers
const getUserByEmail = async (email: string) => {
  if (usePostgres && pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email.toLowerCase()]);
      if (res.rowCount && res.rowCount > 0) {
        return mapUserRow(res.rows[0]);
      }
    } catch (err) {
      console.error("PostgreSQL getUserByEmail failed, trying SQLite fallback:", err);
    }
  }
  return db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email.toLowerCase()) as any;
};

const getUserById = async (id: string) => {
  if (usePostgres && pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM users WHERE id = $1', [id]);
      if (res.rowCount && res.rowCount > 0) {
        return mapUserRow(res.rows[0]);
      }
    } catch (err) {
      console.error("PostgreSQL getUserById failed, trying SQLite fallback:", err);
    }
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
};

const createUser = async (userData: any) => {
  if (usePostgres && pgPool) {
    try {
      await pgPool.query(
        'INSERT INTO users (id, fullName, email, password, accountNumber, role, phoneNumber, address, profileImage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          userData.id,
          userData.fullName,
          userData.email,
          userData.password,
          userData.accountNumber,
          userData.role,
          userData.phoneNumber || '',
          userData.address || '',
          userData.profileImage || ''
        ]
      );
    } catch (err) {
      console.error("PostgreSQL createUser failed:", err);
    }
  }

  // Always write to SQLite as local backup
  try {
    const stmt = db.prepare('INSERT INTO users (id, fullName, email, password, accountNumber, role, phoneNumber, address, profileImage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    stmt.run(
      userData.id, 
      userData.fullName, 
      userData.email, 
      userData.password, 
      userData.accountNumber, 
      userData.role, 
      userData.phoneNumber || '', 
      userData.address || '', 
      userData.profileImage || ''
    );
  } catch (err: any) {
    console.error("SQLite user storage backup error:", err.message);
  }
};

const updateUserProfile = async (id: string, profileData: any) => {
  if (usePostgres && pgPool) {
    try {
      await pgPool.query(
        'UPDATE users SET fullName = $1, phoneNumber = $2, address = $3, profileImage = $4, accountNumber = $5 WHERE id = $6',
        [profileData.fullName, profileData.phoneNumber || '', profileData.address || '', profileData.profileImage || '', profileData.accountNumber, id]
      );
    } catch (err) {
      console.error("PostgreSQL updateUserProfile failed:", err);
    }
  }

  // Update SQLite
  try {
    const stmt = db.prepare(`
      UPDATE users 
      SET fullName = ?, phoneNumber = ?, address = ?, profileImage = ?, accountNumber = ?
      WHERE id = ?
    `);
    stmt.run(profileData.fullName, profileData.phoneNumber, profileData.address, profileData.profileImage, profileData.accountNumber, id);
  } catch (err: any) {
    console.error("SQLite profile update backup error:", err.message);
  }
};

const getAllUsers = async () => {
  if (usePostgres && pgPool) {
    try {
      const res = await pgPool.query('SELECT id, fullName, email, accountNumber, role, phoneNumber, address, profileImage, createdAt FROM users');
      return res.rows.map(mapUserRow);
    } catch (err) {
      console.error("PostgreSQL getAllUsers failed, trying SQLite fallback:", err);
    }
  }
  return db.prepare('SELECT id, fullName, email, accountNumber, role, phoneNumber, address, profileImage, createdAt FROM users').all() as any[];
};

const adminUpdateUser = async (id: string, updateData: any) => {
  if (usePostgres && pgPool) {
    try {
      const keys = Object.keys(updateData);
      if (keys.length > 0) {
        const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
        const values = keys.map(k => updateData[k]);
        await pgPool.query(`UPDATE users SET ${setClause} WHERE id = $${keys.length + 1}`, [...values, id]);
      }
    } catch (err) {
      console.error("PostgreSQL adminUpdateUser failed:", err);
    }
  }

  // Update SQLite
  try {
    const keys = Object.keys(updateData);
    if (keys.length > 0) {
      const setClause = keys.map(k => `${k} = ?`).join(', ');
      const values = keys.map(k => updateData[k]);
      const stmt = db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`);
      stmt.run(...values, id);
    }
  } catch (err: any) {
    console.error("SQLite adminUpdateUser error:", err.message);
  }
};

const adminDeleteUser = async (id: string) => {
  if (usePostgres && pgPool) {
    try {
      await pgPool.query('DELETE FROM users WHERE id = $1', [id]);
    } catch (err) {
      console.error("PostgreSQL adminDeleteUser failed:", err);
    }
  }

  // Delete from SQLite
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  } catch (err: any) {
    console.error("SQLite adminDeleteUser error:", err.message);
  }
};

// Tickets Helpers
const getTicketsList = async (role: string, userId: string) => {
  if (usePostgres && pgPool) {
    try {
      let queryStr = '';
      let values: any[] = [];
      if (role === 'admin') {
        queryStr = 'SELECT * FROM tickets ORDER BY createdAt DESC';
      } else {
        queryStr = 'SELECT * FROM tickets WHERE consumerId = $1 ORDER BY createdAt DESC';
        values = [userId];
      }
      const res = await pgPool.query(queryStr, values);
      return res.rows.map(mapTicketRow);
    } catch (err) {
      console.error("PostgreSQL getTicketsList failed, trying SQLite fallback:", err);
    }
  }

  // SQLite Fallback
  let tickets;
  if (role === 'admin') {
    tickets = db.prepare('SELECT * FROM tickets ORDER BY createdAt DESC').all();
  } else {
    tickets = db.prepare('SELECT * FROM tickets WHERE consumerId = ? ORDER BY createdAt DESC').all(userId);
  }
  return tickets.map((t: any) => ({
    ...t,
    checklist: t.checklist ? JSON.parse(t.checklist) : null,
    messages: t.messages ? JSON.parse(t.messages) : [],
    feedback: t.feedback ? JSON.parse(t.feedback) : null
  }));
};

const getTicketById = async (id: string) => {
  if (usePostgres && pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM tickets WHERE id = $1', [id]);
      if (res.rowCount && res.rowCount > 0) {
        return mapTicketRow(res.rows[0]);
      }
    } catch (err) {
      console.error("PostgreSQL getTicketById failed, trying SQLite fallback:", err);
    }
  }

  // SQLite Fallback
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
  if (!ticket) return null;
  return {
    ...ticket,
    checklist: ticket.checklist ? JSON.parse(ticket.checklist) : null,
    messages: ticket.messages ? JSON.parse(ticket.messages) : [],
    feedback: ticket.feedback ? JSON.parse(ticket.feedback) : null
  };
};

const createTicket = async (ticketData: any) => {
  if (usePostgres && pgPool) {
    try {
      await pgPool.query(
        'INSERT INTO tickets (id, consumerId, consumerName, accountNumber, type, category, description, status, isUrgent, evidenceImage, checklist, messages) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
        [
          ticketData.id,
          ticketData.consumerId,
          ticketData.consumerName,
          ticketData.accountNumber,
          ticketData.type,
          ticketData.category,
          ticketData.description,
          ticketData.status,
          ticketData.isUrgent ? 1 : 0,
          ticketData.evidenceImage || '',
          JSON.stringify(ticketData.checklist || null),
          JSON.stringify(ticketData.messages || [])
        ]
      );
    } catch (err) {
      console.error("PostgreSQL createTicket failed:", err);
    }
  }

  // Write to SQLite
  try {
    const stmt = db.prepare(`
      INSERT INTO tickets (id, consumerId, consumerName, accountNumber, type, category, description, status, isUrgent, evidenceImage, checklist, messages)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      ticketData.id,
      ticketData.consumerId,
      ticketData.consumerName,
      ticketData.accountNumber,
      ticketData.type,
      ticketData.category,
      ticketData.description,
      ticketData.status,
      ticketData.isUrgent ? 1 : 0,
      ticketData.evidenceImage || '',
      JSON.stringify(ticketData.checklist || null),
      JSON.stringify(ticketData.messages || [])
    );
  } catch (err: any) {
    console.error("SQLite createTicket backup error:", err.message);
  }
};

const updateTicket = async (id: string, updateData: any) => {
  if (usePostgres && pgPool) {
    try {
      const { status, messages, feedback, evidenceImage } = updateData;
      if (status !== undefined) {
        await pgPool.query('UPDATE tickets SET status = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2', [status, id]);
      }
      if (messages !== undefined) {
        await pgPool.query('UPDATE tickets SET messages = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2', [JSON.stringify(messages), id]);
      }
      if (feedback !== undefined) {
        await pgPool.query('UPDATE tickets SET feedback = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2', [JSON.stringify(feedback), id]);
      }
      if (evidenceImage !== undefined) {
        await pgPool.query('UPDATE tickets SET evidenceImage = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2', [evidenceImage, id]);
      }
    } catch (err) {
      console.error("PostgreSQL updateTicket failed:", err);
    }
  }

  // Update SQLite first
  try {
    const { status, messages, feedback, evidenceImage } = updateData;
    if (status !== undefined) {
      db.prepare('UPDATE tickets SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
    }
    if (messages !== undefined) {
      db.prepare('UPDATE tickets SET messages = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(messages), id);
    }
    if (feedback !== undefined) {
      db.prepare('UPDATE tickets SET feedback = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(feedback), id);
    }
    if (evidenceImage !== undefined) {
      db.prepare('UPDATE tickets SET evidenceImage = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(evidenceImage, id);
    }
  } catch (err: any) {
    console.error("SQLite updateTicket backup error:", err.message);
  }
};

// Announcements Helpers
const getAnnouncementsList = async () => {
  if (usePostgres && pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM announcements ORDER BY createdAt DESC');
      return res.rows.map(row => ({
        id: row.id,
        title: row.title,
        content: row.content,
        createdAt: row.createdat !== undefined ? row.createdat : row.createdAt
      }));
    } catch (err) {
      console.error("PostgreSQL getAnnouncementsList failed, trying SQLite fallback:", err);
    }
  }
  return db.prepare('SELECT * FROM announcements ORDER BY createdAt DESC').all();
};

const createAnnouncement = async (annData: any) => {
  if (usePostgres && pgPool) {
    try {
      await pgPool.query('INSERT INTO announcements (id, title, content) VALUES ($1, $2, $3)', [annData.id, annData.title, annData.content]);
    } catch (err) {
      console.error("PostgreSQL createAnnouncement failed:", err);
    }
  }

  try {
    db.prepare('INSERT INTO announcements (id, title, content) VALUES (?, ?, ?)').run(annData.id, annData.title, annData.content);
  } catch (err: any) {
    console.error("SQLite createAnnouncement backup error:", err.message);
  }
};

const deleteAnnouncement = async (id: string) => {
  if (usePostgres && pgPool) {
    try {
      await pgPool.query('DELETE FROM announcements WHERE id = $1', [id]);
    } catch (err) {
      console.error("PostgreSQL deleteAnnouncement failed:", err);
    }
  }

  try {
    db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  } catch (err: any) {
    console.error("SQLite deleteAnnouncement backup error:", err.message);
  }
};

// Settings Helpers
const getSettingValue = async (key: string) => {
  if (usePostgres && pgPool) {
    try {
      const res = await pgPool.query('SELECT value FROM settings WHERE key = $1', [key]);
      if (res.rowCount && res.rowCount > 0) {
        return res.rows[0].value;
      }
    } catch (err) {
      console.error("PostgreSQL getSettingValue failed, trying SQLite fallback:", err);
    }
  }
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return setting ? setting.value : null;
};

const setSettingValue = async (key: string, value: any) => {
  if (usePostgres && pgPool) {
    try {
      await pgPool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
    } catch (err) {
      console.error("PostgreSQL setSettingValue failed:", err);
    }
  }

  try {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  } catch (err: any) {
    console.error("SQLite setSettingValue backup error:", err.message);
  }
};

// =========================================================================
// Express Application Server
// =========================================================================

async function startServer() {
  // Initialize PostgreSQL Schema if active
  await initializePostgresSchema();

  // Seed admin & test users
  await seedDatabases();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // --- Auth Middleware ---
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  // --- API Routes ---

  // Auth Routes
  app.post('/api/auth/register', async (req, res) => {
    const { fullName, password, accountNumber, role } = req.body;
    const email = req.body.email?.trim().toLowerCase();
    console.log(`Registration attempt for: ${email}`);

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    try {
      const existingUser = await getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: 'Email already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const id = Math.random().toString(36).substring(2, 15);
      
      const newUser = {
        id,
        fullName,
        email,
        password: hashedPassword,
        accountNumber,
        role: role || 'consumer'
      };

      await createUser(newUser);
      console.log(`User registered successfully in database: ${email}`);
      
      const token = jwt.sign({ id, email, role: role || 'consumer' }, SECRET);
      res.json({ token, user: { id, fullName, email, accountNumber, role: role || 'consumer' } });
    } catch (e: any) {
      console.error(`Registration error for ${email}:`, e.message);
      res.status(400).json({ error: 'Email already exists or registration failed' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;
    console.log(`Login attempt for: ${email}`);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
      const user = await getUserByEmail(email);

      if (user) {
        console.log(`User found: ${user.email} with role: ${user.role}`);
        const isMatch = await bcrypt.compare(password, user.password);
        console.log(`Password comparison result: ${isMatch}`);
        
        if (isMatch) {
          const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, SECRET);
          const { password: _, ...userWithoutPassword } = user;
          console.log(`Login successful for: ${email}`);
          res.json({ token, user: userWithoutPassword });
        } else {
          console.log(`Password mismatch for: ${email}`);
          res.status(401).json({ error: 'Invalid credentials' });
        }
      } else {
        console.log(`User not found: ${email}`);
        res.status(401).json({ error: 'Invalid credentials' });
      }
    } catch (e: any) {
      console.error(`Login error for ${email}:`, e.message);
      res.status(500).json({ error: 'Internal server error during login' });
    }
  });

  app.get('/api/auth/me', authenticateToken, async (req: any, res) => {
    try {
      const user = await getUserById(req.user.id);
      if (user) {
        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
      } else {
        res.status(404).json({ error: 'User not found' });
      }
    } catch (e: any) {
      res.status(500).json({ error: 'Internal server error fetching self' });
    }
  });

  app.patch('/api/auth/profile', authenticateToken, async (req: any, res) => {
    const { fullName, phoneNumber, address, profileImage, accountNumber } = req.body;
    try {
      await updateUserProfile(req.user.id, { fullName, phoneNumber, address, profileImage, accountNumber });
      res.json({ success: true });
    } catch (e: any) {
      console.error("Profile update error:", e);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

  // Tickets Routes
  app.get('/api/tickets', authenticateToken, async (req: any, res) => {
    try {
      const tickets = await getTicketsList(req.user.role, req.user.id);
      res.json(tickets);
    } catch (e: any) {
      console.error("Get tickets failed:", e);
      res.status(500).json({ error: 'Failed to fetch tickets list' });
    }
  });

  app.post('/api/tickets', authenticateToken, async (req: any, res) => {
    const { type, category, description, evidenceImage, checklist, consumerName, accountNumber, isUrgent } = req.body;
    const id = 'TICK-' + Math.random().toString(36).substring(2, 9).toUpperCase();
    
    try {
      const ticketData = {
        id,
        consumerId: req.user.id,
        consumerName,
        accountNumber,
        type,
        category,
        description,
        status: 'pending',
        isUrgent: isUrgent ? 1 : 0,
        evidenceImage: evidenceImage || '',
        checklist: checklist || null,
        messages: []
      };

      await createTicket(ticketData);
      res.json({ id });
    } catch (e: any) {
      console.error("Create ticket failed:", e);
      res.status(500).json({ error: 'Failed to create service request ticket' });
    }
  });

  app.get('/api/tickets/:id', authenticateToken, async (req: any, res) => {
    try {
      const ticket = await getTicketById(req.params.id);
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
      res.json(ticket);
    } catch (e: any) {
      console.error("Get ticket details failed:", e);
      res.status(500).json({ error: 'Failed to fetch ticket' });
    }
  });

  app.patch('/api/tickets/:id', authenticateToken, async (req: any, res) => {
    const { status, messages, feedback, evidenceImage } = req.body;
    try {
      await updateTicket(req.params.id, { status, messages, feedback, evidenceImage });
      res.json({ success: true });
    } catch (e: any) {
      console.error("Update ticket failed:", e);
      res.status(500).json({ error: 'Failed to update ticket' });
    }
  });

  // Announcements Routes
  app.get('/api/announcements', async (req, res) => {
    try {
      const announcements = await getAnnouncementsList();
      res.json(announcements);
    } catch (e: any) {
      console.error("Get announcements failed:", e);
      res.status(500).json({ error: 'Failed to load announcements' });
    }
  });

  app.post('/api/announcements', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    const { title, content } = req.body;
    const id = Math.random().toString(36).substring(2, 15);
    try {
      await createAnnouncement({ id, title, content });
      res.json({ id });
    } catch (e: any) {
      console.error("Create announcement failed:", e);
      res.status(500).json({ error: 'Failed to publish announcement' });
    }
  });

  app.delete('/api/announcements/:id', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
      await deleteAnnouncement(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Delete announcement failed:", e);
      res.status(500).json({ error: 'Failed to delete announcement' });
    }
  });

  // Settings Routes
  app.get('/api/settings/:key', async (req, res) => {
    try {
      const value = await getSettingValue(req.params.key);
      res.json({ value });
    } catch (e: any) {
      console.error("Get setting failed:", e);
      res.status(500).json({ error: 'Failed to load setting' });
    }
  });

  app.post('/api/settings/:key', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    const { value } = req.body;
    try {
      await setSettingValue(req.params.key, value);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Save setting failed:", e);
      res.status(500).json({ error: 'Failed to save system setting' });
    }
  });

  // User Management Routes
  app.get('/api/users', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
      const users = await getAllUsers();
      res.json(users);
    } catch (e: any) {
      console.error("Get all users failed:", e);
      res.status(500).json({ error: 'Failed to retrieve users' });
    }
  });

  app.patch('/api/users/:id', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    const { fullName, email, accountNumber, role, phoneNumber, address } = req.body;
    const updateData: any = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (email !== undefined) updateData.email = email;
    if (accountNumber !== undefined) updateData.accountNumber = accountNumber;
    if (role !== undefined) updateData.role = role;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (address !== undefined) updateData.address = address;

    try {
      await adminUpdateUser(req.params.id, updateData);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Update user failed:", e);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  app.delete('/api/users/:id', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
      await adminDeleteUser(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Delete user failed:", e);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  // --- Vite / Static Files ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
