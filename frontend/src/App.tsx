import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import Room from './components/Room';
import Login from './pages/Login';
import Lobby from './components/Lobby';
import { AuthProvider, useAuth } from './context/AuthContext';

const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-white">Loading...</div>;
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route 
            path="/" 
            element={
              <RequireAuth>
                <Lobby />
              </RequireAuth>
            } 
          />
          <Route 
            path="/room/:id" 
            element={
              <RequireAuth>
                <RoomWrapper />
              </RequireAuth>
            } 
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

// Helper to extract id from URL and pass to Room
function RoomWrapper() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/" />;
  return <Room roomId={id} />;
}

export default App;
