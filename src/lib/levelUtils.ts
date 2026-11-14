import { getNomeContratoHistorico } from "./utils";
import { indexConfirmedOperationTripDates, operationJobTimestamp } from "./operationResultSummary";
import { isOpenJobStatus } from "./jobStatus";
import { buildClientOperationProjection } from "../application/operation/operationProjectionSelectors";

export function getDriverLevelData(driverId: string, jobs: any[], contracts: any[], historicoTrips: any[] = []) {
    const dates = indexConfirmedOperationTripDates(historicoTrips, driverId);
    const tripsByJob = new Map<string, any[]>();
    for (const trip of historicoTrips) {
        const id = String(trip.jobId || "");
        const trips = tripsByJob.get(id) || [];
        trips.push(trip);
        tripsByJob.set(id, trips);
    }
    const contractsById = new Map(contracts.map(contract => [contract.id, contract]));
    const countConfirmedTrips = (job: any): number =>
        buildClientOperationProjection(job, tripsByJob.get(job.id) || [])?.confirmedTripCount ?? 0;

    const allCompletedJobs = jobs.filter(
        (j) => j.driverId === driverId && j.status === "completed",
    ).sort((a, b) => {
        const tsA = operationJobTimestamp(a, dates);
        const tsB = operationJobTimestamp(b, dates);
        
        if (tsB !== tsA) {
            return tsB - tsA;
        }

        const contractA = getNomeContratoHistorico(a, contractsById.get(a.contractId));
        const contractB = getNomeContratoHistorico(b, contractsById.get(b.contractId));
        return contractA.localeCompare(contractB);
    });

    const validActiveJobs = jobs.filter(
        (j) =>
            j.driverId === driverId &&
            isOpenJobStatus(j.status) &&
            contracts.some((c) => c.id === j.contractId)
    );

    validActiveJobs.sort((a, b) => {
        if (a.status === "active" && b.status !== "active") return -1;
        if (a.status !== "active" && b.status === "active") return 1;
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
    });

    const activeJob = validActiveJobs[0] || null;

    const totalDeliveries =
        allCompletedJobs.reduce((acc, job) => acc + countConfirmedTrips(job), 0) +
        (activeJob ? countConfirmedTrips(activeJob) : 0);

    const xp = totalDeliveries * 150 + allCompletedJobs.length * 50;
    const calculatedLevel = Math.floor(xp / 1000) + 1;
    const currentLevelXp = xp % 1000;
    const xpProgress = (currentLevelXp / 1000) * 100;

    return {
        displayLevel: calculatedLevel,
        totalDeliveries,
        allCompletedJobs,
        activeJob,
        xp,
        currentLevelXp,
        xpProgress
    };
}
