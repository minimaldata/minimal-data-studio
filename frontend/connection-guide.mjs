const guides={
 bigquery:{link:['Open BigQuery','https://console.cloud.google.com/bigquery'],steps:[
  ['Find your project and location','In Google Cloud, copy the project ID (not its display name). In BigQuery, select a dataset and check Details → Data location. Enter that location below.'],
  ['Choose your Google account','Install the Google Cloud CLI if needed. Under Google account → Add or reconnect an account, enter a profile name and click Add Google account. Finish sign-in in your browser.'],
  ['Set a query budget','The default 1,000,000,000 bytes is a 1 GB processing cap per query, not a download-size limit. Your account needs permission to run jobs in this project and read the datasets.'],
  ['Save and test','Save connection, then click Connect / refresh beside its name. Open New query and run SELECT 1 AS connection_test; using this connection.']
 ],extra:['Install Google Cloud CLI','https://cloud.google.com/sdk/docs/install']},
 snowflake:{link:['Open Snowflake','https://app.snowflake.com/'],steps:[
  ['Copy your connection details','In Snowflake, open your account connection details. Copy the account identifier (usually organization-account, without https://), login username, role, warehouse and database into the fields below. Ask your administrator if any are missing.'],
  ['Choose how to sign in','Use Browser SSO if your company supports it. For username/password + MFA, click Manage credentials, add your Snowflake password and connect it to this Studio project. Return here, refresh the list and select it.'],
  ['Complete authentication','Save connection, then click Connect / refresh. Finish SSO in your browser, approve an authenticator push, or enter the code in the Mac app as requested. Cached approval may skip MFA; no push is guaranteed.'],
  ['Test your access','Use New query and run SELECT CURRENT_USER(), CURRENT_ROLE();. Your selected role needs warehouse/database/schema USAGE and SELECT on the tables you want to read.']
 ]},
 postgres:{link:['Postgres service profile guide','https://www.postgresql.org/docs/current/libpq-pgservice.html'],steps:[
  ['Get database access','Ask your administrator for the host, port, database, read-only username and trusted CA certificate. Studio requires verified TLS.'],
  ['Create a local service profile','Add a named section to ~/.pg_service.conf on this Mac using the example under Authentication below. These files live in your home folder, outside the Studio project. Enter only the section name in Local Postgres service profile.'],
  ['Store the password locally','Add host:port:database:username:password to ~/.pgpass and run chmod 600 ~/.pgpass in Terminal. Escape colons and backslashes in values with a backslash. Do not put the password in the service profile or project.'],
  ['Save and test','Save connection, click Connect / refresh, then open New query and run SELECT current_database(), current_user;.']
 ],extra:['Password file instructions','https://www.postgresql.org/docs/current/libpq-pgpass.html']},
 supabase:{link:['Open Supabase','https://supabase.com/dashboard'],steps:[
  ['Find the connection parameters','Open your Supabase project → Connect → Session pooler → View parameters. Use port 5432. Copy the host, database and username exactly, including the project suffix in the username.'],
  ['Add your database password','Click Manage credentials below. Add the database password to Keychain and connect it to this Studio project. This is not your Supabase account password, API key or CLI token.'],
  ['Choose the CA certificate','In Supabase → Database Settings → SSL Configuration, download the CA certificate. Click Choose certificate below. Studio verifies TLS even if Supabase’s Enforce SSL toggle is off; this certificate is needed when public CA trust cannot verify the endpoint.'],
  ['Save and test','Refresh credentials, choose your password and save the connection. Click Connect / refresh beside its name and approve Keychain access. In New query, run SELECT current_database(), current_user, now();.']
 ]}
};
export function mountConnectionGuide(form,provider,{open=true}={}){
 const guide=guides[provider];if(!guide)return;
 const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const details=el('details','');details.className='connection-guide';details.open=open;
 details.append(el('summary','Setup directions'));
 const list=el('ol','');for(const [title,text] of guide.steps){const item=el('li','');item.append(el('strong',title),el('p',text));list.append(item);}details.append(list);
 const links=el('div','');links.className='connection-guide-links';
 for(const [label,url] of [guide.link,...(guide.extra?[guide.extra]:[])]){const a=el('a',label+' ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}details.append(links);form.append(details);
}
