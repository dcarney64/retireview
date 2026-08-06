// Connections has moved to Broker Settings — redirect old bookmarks.
import { Navigate } from 'react-router-dom';

export default function Connections() {
  return <Navigate to="/broker-settings" replace />;
}
