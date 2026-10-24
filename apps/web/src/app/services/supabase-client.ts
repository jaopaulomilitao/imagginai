import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

import { logger } from '../../shared/logger';

function normalizeSupabaseUrl(rawUrl: string | undefined): string {
  // remove sufixo /rest/v1 caso tenha sido incluído acidentalmente na variável de ambiente
  const trimmed = (rawUrl ?? '').trim().replace(/\/+$/, '');
  return trimmed.endsWith('/rest/v1')
    ? trimmed.slice(0, -'/rest/v1'.length).replace(/\/+$/, '')
    : trimmed;
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const supabaseAnonKey = (
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''
).trim();

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  if (!supabaseUrl.startsWith('https://') || !supabaseAnonKey) {
    return null;
  }
  cachedClient = createClient(supabaseUrl, supabaseAnonKey);
  return cachedClient;
}

export async function getActiveSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    return data.session;
  } catch (error) {
    logger.warn('failed to read supabase session', error);
    return null;
  }
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getActiveSession();
  return session?.access_token ?? null;
}

export async function signInWithEmail(email: string, password: string): Promise<Session> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não configurados no .env');
  }
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(error?.message ?? 'Não foi possível autenticar com e-mail e senha.');
  }
  return data.session;
}

export async function signUpWithEmail(email: string, password: string): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não configurados no .env');
  }
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) {
    throw new Error(error.message);
  }
  return data.session;
}

export async function signInAnonymously(): Promise<Session> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não configurados no .env');
  }
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session) {
    throw new Error(
      error?.message ?? 'Login anônimo não habilitado neste projeto Supabase. Use e-mail e senha.',
    );
  }
  return data.session;
}

export async function signOutSession(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
}
