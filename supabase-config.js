window.CLASSCREATOR_SUPABASE_CONFIG = Object.freeze({
  url: "https://ulahmnqqafztbcyzfuej.supabase.co",
  anonKey: "sb_publishable_KumwuQbIHedifYaFTNP8Sg_Jc0Dblfr"
});

window.getClassCreatorSupabaseClient = function () {
  if (!window.supabase?.createClient) return null;
  if (!window.CLASSCREATOR_SUPABASE_CLIENT) {
    const config = window.CLASSCREATOR_SUPABASE_CONFIG;
    if (!config?.url || !config?.anonKey) return null;
    window.CLASSCREATOR_SUPABASE_CLIENT = window.supabase.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return window.CLASSCREATOR_SUPABASE_CLIENT;
};
