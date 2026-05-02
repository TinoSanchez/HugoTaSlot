import { supabase } from "./supabase";

function identifierToEmail(identifier) {
  const trimmed = String(identifier || "").trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed;
  return `${trimmed.replace(/[^a-z0-9._-]/g, "")}@player.local`;
}

export async function signUp({ identifier, password, displayName }) {
  const email = identifierToEmail(identifier);
  const username = identifier.includes("@") ? null : identifier.trim();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName || username || email,
        username: username || null,
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn({ identifier, password }) {
  const email = identifierToEmail(identifier);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const sessionUser = sessionData?.session?.user || null;
  if (!sessionUser) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    if (String(error.message || "").toLowerCase().includes("auth session missing")) return null;
    throw error;
  }
  return data.user || sessionUser;
}

export async function fetchProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error) throw error;
  return data;
}

export async function updateMyProfile(payload) {
  const { error } = await supabase.from("profiles").update(payload).eq("id", (await getCurrentUser())?.id);
  if (error) throw error;
}

export async function fetchMyBalance(userId) {
  const { data, error } = await supabase.from("balances").select("amount").eq("user_id", userId).single();
  if (error) throw error;
  return Number(data.amount || 0);
}

export async function listMyHunts(userId) {
  const { data, error } = await supabase
    .from("hunts")
    .select("id,name,currency,starting_balance,created_at,updated_at,archived,hunt_bonuses(id,slot_name,provider,bet,win,bonus_type,sort_order)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createHunt(userId, payload) {
  const { data, error } = await supabase.from("hunts").insert([{ user_id: userId, ...payload }]).select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteHunt(huntId) {
  const { error } = await supabase.from("hunts").delete().eq("id", huntId);
  if (error) throw error;
}

export async function addBonus(huntId, bonus) {
  const { data: maxRow } = await supabase
    .from("hunt_bonuses")
    .select("sort_order")
    .eq("hunt_id", huntId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = Number(maxRow?.sort_order || 0) + 1;
  const { error } = await supabase.from("hunt_bonuses").insert([{ hunt_id: huntId, sort_order: sortOrder, ...bonus }]);
  if (error) throw error;
}

export async function updateBonus(id, patch) {
  const { error } = await supabase.from("hunt_bonuses").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteBonus(id) {
  const { error } = await supabase.from("hunt_bonuses").delete().eq("id", id);
  if (error) throw error;
}

export async function adminListUsers() {
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) throw error;
  return data || [];
}

export async function adminSetBalance(userId, amount, reason) {
  const { error } = await supabase.rpc("admin_set_balance", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason || "manual",
  });
  if (error) throw error;
}

export async function adminAdjustBalance(userId, delta, reason) {
  const { error } = await supabase.rpc("admin_adjust_balance", {
    p_user_id: userId,
    p_delta: delta,
    p_reason: reason || "manual",
  });
  if (error) throw error;
}

export async function adminSetRole(userId, role, reason) {
  const { error } = await supabase.rpc("admin_set_role", {
    p_user_id: userId,
    p_role: role,
    p_reason: reason || "manual",
  });
  if (error) throw error;
}

export async function adminSetStatus(userId, status, reason) {
  const { error } = await supabase.rpc("admin_set_status", {
    p_user_id: userId,
    p_status: status,
    p_reason: reason || "manual",
  });
  if (error) throw error;
}

export async function adminListHunts() {
  const { data, error } = await supabase
    .from("hunts")
    .select("id,user_id,name,currency,starting_balance,created_at,archived,profiles!hunts_user_id_fkey(display_name,username)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return data || [];
}

export async function adminArchiveHunt(huntId, archived) {
  const { error } = await supabase.rpc("admin_archive_hunt", { p_hunt_id: huntId, p_archived: archived });
  if (error) throw error;
}

export async function adminDeleteHunt(huntId) {
  const { error } = await supabase.rpc("admin_delete_hunt", { p_hunt_id: huntId });
  if (error) throw error;
}

export async function adminLogs(limit = 200) {
  const { data, error } = await supabase
    .from("admin_audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
