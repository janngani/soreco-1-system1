import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/src/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { LogIn, Loader2, ArrowLeft } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const loggedInUser = await login({ email: email.trim().toLowerCase(), password });
      toast.success(`Welcome back, ${loggedInUser.fullName || 'User'}!`);
      
      if (loggedInUser.role === 'admin') {
        navigate('/admin');
      } else {
        navigate('/dashboard');
      }
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Failed to login. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto flex flex-col items-center justify-center min-h-[calc(100vh-140px)] px-4 py-8">
      {/* Back button */}
      <div className="w-full max-w-md mb-4 flex justify-start">
        <Button 
          variant="ghost" 
          size="sm" 
          className="text-slate-500 hover:text-slate-800 flex items-center gap-2"
          onClick={() => navigate('/')}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Button>
      </div>

      <Card className="w-full max-w-md shadow-xl border border-slate-100 overflow-hidden bg-white/80 backdrop-blur-md">
        <div className="h-2 bg-gradient-to-r from-primary to-slate-900 w-full" />
        <CardHeader className="space-y-2 text-center pt-8 pb-6">
          <CardTitle className="text-3xl font-bold tracking-tight text-slate-900">
            SORECO-1 Portal
          </CardTitle>
          <CardDescription className="text-slate-500 text-sm">
            Sign in with your email and password to access the portal
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleLogin}>
          <CardContent className="space-y-5 pb-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-700 font-medium">Email Address</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="Enter email address" 
                required 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="focus-visible:ring-primary border-slate-200"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-slate-700 font-medium">Password</Label>
                <Link to="#" className="text-xs text-primary hover:underline font-medium">
                  Forgot password?
                </Link>
              </div>
              <Input 
                id="password" 
                type="password" 
                placeholder="••••••••"
                required 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="focus-visible:ring-primary border-slate-200"
              />
            </div>
          </CardContent>

          <CardFooter className="flex flex-col space-y-4 pt-0 pb-8">
            <Button 
              type="submit" 
              className="w-full text-white bg-primary hover:bg-primary/95 transition-all text-sm font-medium h-11"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="mr-2 h-4 w-4" />
              )}
              Sign In to Portal
            </Button>

            <div className="text-center text-sm text-slate-500">
              Don't have a consumer account?{' '}
              <Link to="/register" className="text-primary font-semibold hover:underline">
                Register here
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};
