
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://emsjctbdevufloxntjll.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtc2pjdGJkZXZ1ZmxveG50amxsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjU5MTgyMiwiZXhwIjoyMDgyMTY3ODIyfQ.sMkVWytO3r37HvWcw5QpgJrzochf0UTpsoL4lVs0V0U";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDuplicates() {
  console.log('--- Checking for duplicate profiles by email ---');
  
  // Get all emails that appear more than once
  // Since we can't do complex aggregation in PostgREST easily without RPC, 
  // we'll just fetch all profiles and do it in JS if it's not too many.
  // Or at least a large batch.
  
  const { data: allProfiles, error } = await supabase
    .from('profiles')
    .select('id, email, username, platform_role, created_at');

  if (error) {
    console.error('Error fetching profiles:', error);
    return;
  }

  const byEmail = {};
  allProfiles.forEach(p => {
    if (p.email) {
      if (!byEmail[p.email]) byEmail[p.email] = [];
      byEmail[p.email].push(p);
    }
  });

  let foundDups = false;
  for (const [email, profiles] of Object.entries(byEmail)) {
    if ((profiles as any).length > 1) {
      foundDups = true;
      console.log(`\nDuplicate found for: ${email}`);
      (profiles as any).forEach(p => {
        console.log(`  - ID: ${p.id}, Role: ${p.platform_role}, Created: ${p.created_at}`);
      });
    }
  }

  if (!foundDups) {
    console.log('No duplicate emails found in the first batch of profiles.');
    // If no dups found, maybe check for admins specifically
    const admins = allProfiles.filter(p => p.platform_role === 'ADMIN');
    console.log(`\nFound ${admins.length} admins total.`);
    admins.forEach(a => console.log(`  - ${a.email} (${a.id})`));
  }
}

checkDuplicates();
