const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const envVars = fs.readFileSync(".env.local", "utf-8").split("\n").filter(line => line.trim() && !line.startsWith("#")).reduce((acc, line) => { const [key, ...values] = line.split("="); acc[key.trim()] = values.join("=").trim().replace(/(^"|"$)/g, ""); return acc; }, {});
const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY);
(async () => {
  const { data, error } = await supabase.from("auto_messages").select("*").limit(10);
  console.log("Auto messages table:");
  console.log(data);
})();
