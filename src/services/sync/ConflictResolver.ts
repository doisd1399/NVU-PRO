export class ConflictResolver {
  resolve(local:any, server:any){
    if (!server) return local;
    const localTime = local.clientUpdatedAt || 0;
    const serverTime = server.serverUpdatedAt || 0;
    return localTime >= serverTime ? local : server;
  }
}
