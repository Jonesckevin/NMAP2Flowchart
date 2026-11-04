import type { DiagramDoc } from '../doc/types';
import type { RiskPolicy } from '../doc/risk';

export type AuthFeatures = {
  authEnabled: boolean;
  registrationEnabled: boolean;
  guestLoginEnabled: boolean;
  guestTtlHours: number;
  maxProjectBytes: number;
  /** Instance-wide risk levels from the server, when it was configured with them. */
  risk?: RiskPolicy | null;
};

export type AccountUser = {
  userId: string;
  username: string;
  role: string;
  isGuest: boolean;
  createdAt: number;
};

export type ProjectSummary = {
  id: string;
  name: string;
  nodeCount: number;
  edgeCount: number;
  createdAt: number;
  updatedAt: number;
};

export type ProjectDetail = ProjectSummary & { doc: DiagramDoc };

export type AuthResponse = {
  user: AccountUser;
  token: string;
  expiresAt: number;
};
