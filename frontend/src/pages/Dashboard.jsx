import { useAuthStore } from '../store/authStore';

export default function Dashboard() {
  const user = useAuthStore((state) => state.user);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">
        Welcome, {user?.fullName || user?.email || 'there'}
      </h2>
      <p className="text-slate-400">
        {/* TODO: replace this placeholder with your app's dashboard */}
        This is your app&apos;s home page. Start building here.
      </p>
    </div>
  );
}
