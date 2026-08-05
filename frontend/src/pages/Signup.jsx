import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import PasswordStrengthMeter from '../components/shared/PasswordStrengthMeter';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useAuthStore } from '../store/authStore';

export default function Signup() {
  const navigate = useNavigate();
  const register = useAuthStore((state) => state.register);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(fullName, email, password);
      navigate('/');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6 text-slate-100">
      <Card className="w-full max-w-md border-slate-700 bg-slate-800 text-white">
        <div className="mb-6 text-center">
          {/* TODO: replace with your app name */}
          <h1 className="mb-2 text-3xl font-semibold tracking-tight text-white">RetireView</h1>
          <p className="text-sm text-slate-300">Create your account</p>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-200" htmlFor="fullName">
              Full Name
            </label>
            <Input
              id="fullName"
              type="text"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="border-slate-600 bg-slate-700 text-white placeholder:text-slate-400"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-200" htmlFor="email">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-slate-600 bg-slate-700 text-white placeholder:text-slate-400"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-200" htmlFor="password">
              Password
            </label>
            <Input
              id="password"
              type="password"
              placeholder="Password (min 12 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-slate-600 bg-slate-700 text-white placeholder:text-slate-400"
              required
              minLength={12}
            />
            <PasswordStrengthMeter
              password={password}
              userInputs={[email, email.split('@')[0], fullName, ...fullName.split(' ')]}
            />
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <Button className="w-full bg-sky-500 text-white hover:bg-sky-600" type="submit" disabled={loading}>
            {loading ? 'Creating Account...' : 'Create Account'}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="text-sky-400 hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
