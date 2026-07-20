import React, { createContext, useContext, useEffect, useState } from 'react';
import { BACKEND_URL } from '../config';
import { socket } from '../lib/socket';

export interface AuthUser {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean | null;
  loading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: null,
  loading: true,
  logout: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Check for token in URL
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');
    
    if (tokenFromUrl) {
      localStorage.setItem('auth_token', tokenFromUrl);
      // Clean the URL immediately without reloading the page
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const currentToken = localStorage.getItem('auth_token');
    
    if (!currentToken) {
      setIsAuthenticated(false);
      setLoading(false);
      return;
    }

    fetch(`${BACKEND_URL}/api/auth/me`, { 
      headers: {
        'ngrok-skip-browser-warning': 'true',
        'Authorization': `Bearer ${currentToken}`
      }
    })
      .then(res => {
        if (res.ok) {
          res.json().then(data => {
            setUser(data);
            setIsAuthenticated(true);
            setLoading(false);
          });
        } else {
          setIsAuthenticated(false);
          setLoading(false);
          localStorage.removeItem('auth_token'); // Clear invalid token
        }
      })
      .catch(() => {
        setIsAuthenticated(false);
        setLoading(false);
      });
  }, []);

  const logout = () => {
    localStorage.removeItem('auth_token');
    setIsAuthenticated(false);
    setUser(null);
    socket.disconnect();
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
