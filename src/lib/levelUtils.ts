import { getNomeContratoHistorico } from "./utils";
import { getJobRealTimestamp } from "./utils";
import { isOpenJobStatus } from "./jobStatus";

export function getDriverLevelData(driverId: string, jobs: any[], contracts: any[], historicoTrips: any[] = []) {
    const allCompletedJobs = jobs.filter(
        (j) => j.driverId === driverId && j.status === "completed",
    ).sort((a, b) => {
        const tsA = getJobRealTimestamp(a, historicoTrips);
        const tsB = getJobRealTimestamp(b, historicoTrips);
        
        if (tsB !== tsA) {
            return tsB - tsA;
        }

        const contractA = getNomeContratoHistorico(a, contracts.find((c) => c.id === a.contractId));
        const contractB = getNomeContratoHistorico(b, contracts.find((c) => c.id === b.contractId));
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
        allCompletedJobs.reduce((acc, job) => acc + (Number(job.progress) || 0), 0) +
        (activeJob ? (Number(activeJob.progress) || 0) : 0);

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
