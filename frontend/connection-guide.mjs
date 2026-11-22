const guides={
 bigquery:{link:['Open BigQuery','https://console.cloud.google.com/bigquery'],steps:[
  ['Find your project and location','In Google Cloud, copy the project ID (not its display name). In BigQuery, select a dataset and check Details → Data location. Enter it in Dataset location.'],
  ['Choose your Google account','Install the Google Cloud CLI if needed. Under Google account → Add or reconnect an account, enter a profile name and click Add Google account. Finish sign-in in your browser.'],
  ['Set a query budget','The default 1,000,000,000 bytes is a 1 GB processing cap per query, not a download-size limit. Your account needs permission to run jobs in this project and read the datasets.'],
  ['Save and test','Save connection, then click Connect / refresh beside its name. Open New query and run SELECT 1 AS connection_test; using this connection.']
 ],extra:['Install Google Cloud CLI','https://cloud.google.com/sdk/docs/install']},
 snowflake:{link:['Open Snowflake','https://app.snowflake.com/'],steps:[
  ['Copy your connection details','In Snowflake, open your account connection details. Copy the account identifier (usually organization-account, without https://), login username, role, warehouse and database into the matching connection fields. Ask your administrator if any are missing.'],
  ['Choose how to sign in','Use Browser SSO if your company supports it. For username/password + MFA, click Manage credentials, add your Snowflake password. Return to Authentication, click Refresh credentials and select the Keychain password.'],
  ['Complete authentication','Save connection, then click Connect / refresh. Finish SSO in your browser, approve an authenticator push, or enter the code in the Mac app as requested. Cached approval may skip MFA; no push is guaranteed.'],
  ['Test your access','Use New query and run SELECT CURRENT_USER(), CURRENT_ROLE();. Your selected role needs warehouse/database/schema USAGE and SELECT on the tables you want to read.']
 ]},
 postgres:{link:['Postgres connection parameters','https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-PARAMKEYWORDS'],steps:[
  ['Find your connection details','Use the host, port, database name and username from your database tool, hosting provider or administrator.'],
  ['Choose your database password','Click Manage credentials, add the database password, then refresh and select it. Use the database password, not a database tool’s master password.'],
  ['Check the server certificate','No certificate file is needed for a publicly trusted server certificate. For a private or self-signed certificate, ask your administrator for its CA file and click Choose certificate. Studio requires verified TLS. If your connection uses an SSH tunnel, enable Connect through an SSH server in SSH tunnel and copy its SSH host, port and username. Choose the same private key; add its passphrase to Credentials if needed. Keep the actual database hostname in Database host.'],
  ['Save and test','Save connection and use Test connection in the connections manager. Then attach it to your project and run SELECT current_database(), current_user;.']
 ]},
 supabase:{link:['Open Supabase','https://supabase.com/dashboard'],steps:[
  ['Find the connection parameters','Open your Supabase project → Connect → Session pooler → View parameters. Use port 5432. Copy the host, database and username exactly, including the project suffix in the username.'],
  ['Add your database password','Click Manage credentials beside the database password selector. Add the database password to Keychain. This is not your Supabase account password, API key or CLI token.'],
  ['Choose the CA certificate','In Supabase → Database Settings → SSL Configuration, download the CA certificate. Click Choose certificate in Verify the server certificate. Studio verifies TLS even if Supabase’s Enforce SSL toggle is off; this certificate is needed when public CA trust cannot verify the endpoint.'],
  ['Save and test','Refresh credentials, choose your password and save the connection. Click Connect / refresh beside its name and approve Keychain access. In New query, run SELECT current_database(), current_user, now();.']
 ]}
};
// Instruction navigation never submits or changes the connection form.
export function mountConnectionGuide(form,provider,{open=true}={}){
 const guide=guides[provider];if(!guide)return;
 const el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text||''});
 const details=el('details');details.className='connection-guide';details.open=open;
 details.append(el('summary','Setup directions'));
 const progress=el('div');progress.className='setup-progress';progress.setAttribute('aria-label','Setup instruction steps');
 const body=el('section');body.className='connection-guide-step';body.setAttribute('aria-live','polite');
 const heading=el('h4'),text=el('p');body.append(heading,text);
 const actions=el('div');actions.className='connection-guide-navigation';
 const back=el('button','Previous step'),next=el('button','Next step'),count=el('span');
 back.type=next.type='button';actions.append(back,count,next);
 let current=0;
 const buttons=guide.steps.map(([title],i)=>{const b=el('button',String(i+1));b.type='button';b.title=title;b.setAttribute('aria-label',`Step ${i+1}: ${title}`);b.onclick=()=>show(i);progress.append(b);return b;});
 function show(i){current=i;heading.textContent=guide.steps[i][0];text.textContent=guide.steps[i][1];count.textContent=`${i+1} of ${guide.steps.length}`;back.disabled=i===0;next.disabled=i===guide.steps.length-1;buttons.forEach((b,n)=>{if(n===i)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});}
 back.onclick=()=>show(Math.max(0,current-1));next.onclick=()=>show(Math.min(guide.steps.length-1,current+1));
 const links=el('div');links.className='connection-guide-links';
 for(const [label,url] of [guide.link,...(guide.extra?[guide.extra]:[])]){const a=el('a',label+' ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}
 details.append(progress,body,actions,links);form.append(details);show(0);
}
