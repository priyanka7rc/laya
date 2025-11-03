"use client";

import { useAuth } from './AuthProvider';
import BottomNavigation from './BottomNavigation';

export default function ConditionalNav() {
  const { user, loading } = useAuth();

  // Don't show nav while loading or if not authenticated
  if (loading || !user) {
    return null;
  }

  return <BottomNavigation />;
}