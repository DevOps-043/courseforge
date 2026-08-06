
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://emsjctbdevufloxntjll.supabase.co";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAdmins() {
  console.log('--- Checking all ADMIN profiles ---');
  const { data: admins, error } = await supabase
    .from('profiles')
    .select('id, email, username, first_name, platform_role')
    .eq('platform_role', 'ADMIN');

  if (error) {
    console.error('Error fetching admins:', error);
    return;
  }

  console.log(`Found ${admins?.length || 0} admins:`);
  console.log(JSON.stringify(admins, null, 2));

  // Also check for potential duplicates
  const emails = admins?.map(a => a.email).filter(Boolean);
  if (emails && emails.length > 0) {
    console.log('\n--- Checking for duplicates by email ---');
    const { data: allWithSameEmails, error: emailErr } = await supabase
      .from('profiles')
      .select('id, email, username, platform_role')
      .in('email', emails);

    if (emailErr) console.error('Error checking emails:', emailErr);
    else {
      const counts = allWithSameEmails?.reduce((acc: any, curr: any) => {
        acc[curr.email] = (acc[curr.email] || 0) + 1;
        return acc;
      }, {});

      Object.entries(counts).forEach(([email, count]) => {
        if (count as any > 1) {
          console.log(`Duplicate found for ${email}: ${count} records`);
          const dups = allWithSameEmails.filter(p => p.email === email);
          console.log(JSON.stringify(dups, null, 2));
        }
      });
    }
  }
}

checkAdmins();
