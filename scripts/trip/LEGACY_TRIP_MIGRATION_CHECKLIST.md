# Checklist de migração de legado de viagem

- [ ] Nenhuma tela cria viagem diretamente
- [ ] Nenhum cálculo de cachê fora do TripEarningsService
- [ ] Histórico utiliza CanonicalTripStore
- [ ] Operação recebe TRIP_REGISTERED
- [ ] SyncEngine é o único responsável por sincronização
- [ ] Exclusões usam status DELETED
