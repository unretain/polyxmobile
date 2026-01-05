"use client";

// Mobile app: Social features removed - not available in wallet-only auth mode

interface SocialPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SocialPanel({ isOpen, onClose }: SocialPanelProps) {
  // Social features are not available on mobile
  return null;
}
