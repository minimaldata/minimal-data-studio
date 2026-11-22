// Help choices affect instructions only, never connection values or authentication.
const tools={
 pgadmin:{name:'pgAdmin',database:'In pgAdmin, right-click the server → Properties → Connection. Copy Host name/address, Port and Username. Choose your database from the Databases tree; it may differ from Maintenance database.',ssh:'Check Properties → SSH Tunnel for the SSH host, port, username and identity file.',url:'https://www.pgadmin.org/docs/pgadmin4/latest/server_dialog.html'},
 dbeaver:{name:'DBeaver',database:'In Database Navigator, right-click the connection → Edit Connection. Copy Host, Port, Database and Username from the connection settings.',ssh:'Check the SSH settings in Edit Connection. Copy the jump-host details and choose the same private key.',url:'https://dbeaver.com/docs/dbeaver/Database-driver-PostgreSQL/'},
 datagrip:{name:'DataGrip',database:'Open Data Sources and Drivers, select the data source and use the General tab for Host, Port, Database and User.',ssh:'Check the SSH/SSL tab for the SSH configuration and private key.',url:'https://www.jetbrains.com/help/datagrip/data-sources-and-drivers-dialog.html'}
};
const providers={
 aws:{name:'AWS RDS / Aurora',database:'In the RDS console, select your PostgreSQL database and open Connectivity & security for its endpoint and port. Use a database username, not your AWS sign-in.',ssh:'For a private RDS endpoint, use an existing network route such as your organization’s VPN or an approved EC2 SSH jump host. Studio does not change AWS network access.',certificate:'Download the AWS RDS CA bundle for your database and use Choose certificate in the Server certificate step.',url:'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ConnectToPostgreSQLInstance.html',certificateURL:'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html'},
 google:{name:'Google Cloud SQL',database:'In Google Cloud, select your Cloud SQL PostgreSQL instance. Find its connection address under Connections and the database and username under Databases and Users. An instance connection name is not a hostname.',ssh:'Studio needs a reachable database endpoint. It does not start the Cloud SQL Auth Proxy or configure private networking. Ask your administrator for the supported connection route.',certificate:'Use the server CA certificate configured for this instance. Client-certificate authentication and Cloud SQL Auth Proxy setup are not supported by this form.',url:'https://docs.cloud.google.com/sql/docs/postgres/connection-options'},
 azure:{name:'Azure Database for PostgreSQL',database:'In Azure, open your PostgreSQL server and copy its fully qualified server name. Use the database name and PostgreSQL username supplied for this server.',ssh:'Public endpoints need permitted network access; private endpoints need your organization’s private-network route. Studio does not change firewall or network settings.',certificate:'Follow your server’s current TLS certificate guidance. Select a CA file if its certificate is not verified by public CA trust. This flow uses a database password, not Microsoft Entra sign-in.',url:'https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/quickstart-create-server'}
};
export function mountPostgresGuidance(host,update){
 const el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text||''});
 const details=el('details');details.open=true;details.className='postgres-guidance';details.append(el('summary','Where are your connection details?'));
 const chooser=(title,choices,placeholder)=>{const label=el('label',title),select=el('select');select.setAttribute('aria-label',title);select.add(new Option(placeholder,''));for(const [key,value] of Object.entries(choices))select.add(new Option(value.name,key));label.append(select);details.append(label);return select;};
 const tool=chooser('Database tool',tools,'I already have the details'),provider=chooser('Hosting provider',providers,'Other / not sure');
 const links=el('div');links.className='connection-guide-links';details.append(links);
 const refresh=()=>{const t=tools[tool.value],p=providers[provider.value];
  update({database:[t?.database,p?.database].filter(Boolean).join(' ')||'Enter the database host, port, database name and username supplied by your administrator or hosting provider.',
   ssh:[t?.ssh,p?.ssh,'Enable a tunnel only if your connection needs one. Select an existing private key on this Mac; another tool’s tunnel is not automatically reused.'].filter(Boolean).join(' '),
   certificate:p?.certificate||'A publicly trusted server certificate may need no extra file. For a private or self-signed certificate, obtain the CA file from your administrator or hosting provider.'});
  links.replaceChildren();for(const item of [t,p].filter(Boolean)){const a=el('a',item.name+' directions ↗');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}
  if(p?.certificateURL){const a=el('a','CA certificate downloads ↗');a.href=p.certificateURL;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}
 };
 tool.onchange=provider.onchange=refresh;host.append(details);refresh();
}
