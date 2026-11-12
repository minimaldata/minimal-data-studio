/** Local-service transport. Remote database credentials must never enter this layer. */
export async function checkedResponse(response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || (response.status === 404
      ? 'This server does not support that action. It may be running older code. Restart Minimal Data Studio (or the development server), then reload this page.'
      : `The local server could not complete this request (HTTP ${response.status}).`));
    error.status = response.status;
    throw error;
  }
  return response;
}
export function createSessionClient(getSession, transport = fetch) {
  return async (path, options = {}) => {
    const session = getSession();
    if (!session?.session) throw new Error('The project is not connected yet.');
    return checkedResponse(await transport(path + (path.includes('?') ? '&' : '?') + 'session=' + encodeURIComponent(session.session), options));
  };
}
export async function jsonRequest(path, body, transport = fetch) {
  return (await checkedResponse(await transport(path, body === undefined ? {} : {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
  }))).json();
}
