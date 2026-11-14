export const TripDeletionPolicy = {
  markDeleted(trip:any){
    return { ...trip, status: 'DELETED', deleted: true, updatedAt: Date.now() };
  }
};
