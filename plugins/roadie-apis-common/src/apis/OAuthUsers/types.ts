export type BackendToken = {
  tokenName: string;
  createdAt: string;
  expiresAt: string;
  id: string;
  maskedToken?: string;
  token?: string;
};

export type User = {
  email: string;
  email_verified: boolean;
  user_id: string;
  username?: string;
  picture: string;
  nickname: string;
  name: string;
  last_login: string;
  roles?: string[];
};

export type SuggestedRole = {
  roleSuggestions: string[];
  user: User;
  forPosting: {
    roleIds: string[];
    userId: string;
  };
};
