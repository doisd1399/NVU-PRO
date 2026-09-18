import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef } from "firebase/storage";
import {
  useOperationalStore,
  RecruitmentApplication,
} from "../../../context/AppContext";
import { useCompanyStore } from "../../../context/CompanyContext";
import {
  Copy,
  Target,
  CheckCircle2,
  XCircle,
  Search,
  Save,
  LayoutTemplate,
  Users2,
  FileText,
  Check,
  ExternalLink,
  X,
  Mail,
  Phone,
  Gamepad2,
  Car,
  Clock,
  Trash2,
  Loader2,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Card, CardContent } from "../../../components/ui/Card";
import { StableImage } from "../../../components/common/StableImage";
import { db, storage } from "../../../lib/firebase";
import {
  getRecruitmentInitials,
  getRecruitmentPhotoCandidates,
  getRecruitmentPhotoStorageCandidates,
  resolveRecruitmentPhoto,
} from "../../../lib/recruitmentPhoto";
import { isCompanyRegistration } from "../../../lib/registrationImages";
import { resolveNotifications } from "../../../services/notificationService";

type CandidateProfile = object | null;

const RECRUITMENT_HISTORY_PAGE_SIZE = 20;

function CandidateAvatar({
  name,
  srcCandidates = [],
  wrapperClassName,
  imageClassName = "rounded-full object-cover",
  muted = false,
}: {
  name: string;
  srcCandidates?: string[];
  wrapperClassName: string;
  imageClassName?: string;
  muted?: boolean;
}) {
  const initials = getRecruitmentInitials(name);
  const candidates = React.useMemo(
    () => Array.from(new Set(srcCandidates.filter(Boolean))),
    [srcCandidates],
  );
  const candidateKey = candidates.join("\u0000");
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidateKey]);

  const src = candidates[candidateIndex] || null;
  return (
    <StableImage
      src={src}
      alt={name}
      referrerPolicy="no-referrer"
      wrapperClassName={wrapperClassName}
      className={`${imageClassName}${muted ? " opacity-80" : ""}`}
      onError={() => {
        setCandidateIndex((current) =>
          current < candidates.length - 1 ? current + 1 : current,
        );
      }}
      fallback={
        <span
          aria-hidden="true"
          className={`flex h-full w-full items-center justify-center rounded-full bg-indigo-50 text-[11px] font-bold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300${muted ? " opacity-80" : ""}`}
        >
          {initials}
        </span>
      }
    />
  );
}

function AdminRecruitment({ onFormOpen }: { onFormOpen?: (isOpen: boolean) => void }) {
  const navigate = useNavigate();
  const {
    activeCompanyId,
    companies,
    recruitmentApplications,
    updateRecruitmentSettings,
    approveRecruitmentApplication,
    rejectRecruitmentApplication,
    deleteRecruitmentApplication,
  } = useCompanyStore();
  const { users } = useOperationalStore();

  const [activeTab, setActiveTab] = useState<"candidates" | "page">(
    "candidates",
  );
  const [search, setSearch] = useState("");
  const [historyApplications, setHistoryApplications] = useState<
    RecruitmentApplication[]
  >([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyCursorRef = React.useRef<
    QueryDocumentSnapshot<DocumentData> | null
  >(null);
  const historyLoadingRef = React.useRef(false);
  const historyRequestRef = React.useRef(0);

  const activeCompany = companies.find((c) => c.id === activeCompanyId);
  const [copiedLink, setCopiedLink] = useState(false);

  // Form for page settings
  const [settingsForm, setSettingsForm] = useState({
    about: "",
    rules: "",
    howItWorks: "",
    benefits: "",
    isActive: false,
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [selectedHistoryApp, setSelectedHistoryApp] = useState<RecruitmentApplication | null>(null);

  // Pending applicants are not always present in the company-scoped users
  // listener yet. Keep both indexes so an application can still resolve its
  // explicit profile photo by UID or by normalized email.
  const usersByEmail = React.useMemo(
    () =>
      new Map(
        users
          .filter((user) => typeof user.email === "string")
          .map((user) => [user.email.trim().toLowerCase(), user]),
      ),
    [users],
  );
  const usersById = React.useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  );
  const [candidateProfiles, setCandidateProfiles] = useState<
    Record<string, CandidateProfile>
  >({});
  const [candidatePhotoUrls, setCandidatePhotoUrls] = useState<
    Record<string, string>
  >({});

  const handleSetSelectedHistoryApp = (app: RecruitmentApplication | null) => {
    setSelectedHistoryApp(app);
    if (app) {
      void resolveNotifications({
        companyId: app.companyId,
        type: "RH_APPLICATION",
        metadata: { applicationId: app.id },
      });
    }
    if (onFormOpen) {
      onFormOpen(app !== null);
    }
  };
  const [appToDelete, setAppToDelete] = useState<string | null>(null);

  const getTimeSince = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (days > 0) return `${days} dia${days > 1 ? "s" : ""}`;
    if (hours > 0) return `${hours} hora${hours > 1 ? "s" : ""}`;
    return "Agora mesmo";
  };

  useEffect(() => {
    if (activeCompany?.recruitmentSettings) {
      setSettingsForm({
        about: activeCompany.recruitmentSettings.about || "",
        rules: activeCompany.recruitmentSettings.rules || "",
        howItWorks: activeCompany.recruitmentSettings.howItWorks || "",
        benefits: activeCompany.recruitmentSettings.benefits || "",
        isActive: activeCompany.recruitmentSettings.isActive ?? true,
      });
    }
  }, [activeCompany?.recruitmentSettings]);

  const handleCopyLink = () => {
    if (!activeCompanyId) return;
    const url = `${window.location.origin}/apply/${activeCompanyId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSaveSettings = async () => {
    if (!activeCompanyId) return;
    setIsSavingSettings(true);
    try {
      await updateRecruitmentSettings(activeCompanyId, settingsForm);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      alert("Erro ao salvar as configurações.");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const loadRecruitmentHistory = React.useCallback(
    async (reset = false) => {
      if (!activeCompanyId || historyLoadingRef.current) return;

      historyLoadingRef.current = true;
      setHistoryLoading(true);
      const requestId = ++historyRequestRef.current;

      try {
        const constraints: QueryConstraint[] = [
          where("companyId", "==", activeCompanyId),
          orderBy("createdAt", "desc"),
          limit(RECRUITMENT_HISTORY_PAGE_SIZE),
        ];
        const cursor = reset ? null : historyCursorRef.current;
        if (cursor) constraints.splice(2, 0, startAfter(cursor));

        let snapshot: QuerySnapshot<DocumentData>;
        try {
          snapshot = await getDocs(
            query(collection(db, "recruitment_applications"), ...constraints),
          );
        } catch (optimizedError) {
          if (!reset) throw optimizedError;
          // Enquanto o índice composto ainda não foi publicado, preserve a
          // tela com uma consulta limitada e ordenação local. O deploy final
          // ativará a paginação por cursor sem tornar a interface dependente.
          console.warn(
            "[Recruitment] Paginação otimizada indisponível; usando fallback limitado.",
            optimizedError,
          );
          snapshot = await getDocs(
            query(
              collection(db, "recruitment_applications"),
              where("companyId", "==", activeCompanyId),
              limit(100),
            ),
          );
        }

        if (requestId !== historyRequestRef.current) return;

        const rows = snapshot.docs
          .map(
            (applicationDocument) =>
              ({
                ...applicationDocument.data(),
                id: applicationDocument.id,
              }) as RecruitmentApplication,
          )
          .filter(
            (application) =>
              !isCompanyRegistration(application) &&
              (application.status !== "pending" ||
                application.isCurrent === false),
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() -
              new Date(a.createdAt).getTime(),
          );

        setHistoryApplications((current) => {
          const merged = new Map<string, RecruitmentApplication>();
          (reset ? [] : current).forEach((application) =>
            merged.set(application.id, application),
          );
          rows.forEach((application) =>
            merged.set(application.id, application),
          );
          return Array.from(merged.values()).sort(
            (a, b) =>
              new Date(b.createdAt).getTime() -
              new Date(a.createdAt).getTime(),
          );
        });

        historyCursorRef.current =
          snapshot.docs[snapshot.docs.length - 1] ?? null;
        setHistoryHasMore(
          snapshot.docs.length === RECRUITMENT_HISTORY_PAGE_SIZE,
        );
      } catch (error) {
        console.warn(
          "[Recruitment] Não foi possível carregar o histórico paginado:",
          error,
        );
        if (reset && requestId === historyRequestRef.current) {
          setHistoryApplications([]);
          setHistoryHasMore(false);
          historyCursorRef.current = null;
        }
      } finally {
        if (requestId === historyRequestRef.current) {
          historyLoadingRef.current = false;
          setHistoryLoading(false);
        }
      }
    },
    [activeCompanyId],
  );

  useEffect(() => {
    historyRequestRef.current += 1;
    historyCursorRef.current = null;
    historyLoadingRef.current = false;
    setHistoryApplications([]);
    setHistoryHasMore(false);
    setHistoryLoading(false);
    if (activeCompanyId) void loadRecruitmentHistory(true);
  }, [activeCompanyId, loadRecruitmentHistory]);

  const applications = React.useMemo(() => {
    const merged = new Map<string, RecruitmentApplication>();
    historyApplications.forEach((application) =>
      merged.set(application.id, application),
    );
    recruitmentApplications.forEach((application) =>
      merged.set(application.id, application),
    );

    return Array.from(merged.values()).filter((application) => {
      if (activeCompanyId && application.companyId !== activeCompanyId)
        return false;
      if (isCompanyRegistration(application)) return false;
      return true;
    });
  }, [activeCompanyId, historyApplications, recruitmentApplications]);

  const updateHistoryApplicationStatus = React.useCallback(
    (applicationId: string, status: "approved" | "rejected") => {
      const source = applications.find(
        (application) => application.id === applicationId,
      );
      if (!source) return;
      const updated = { ...source, status };
      setHistoryApplications((current) => [
        updated,
        ...current.filter((application) => application.id !== applicationId),
      ]);
      setSelectedHistoryApp((current) =>
        current?.id === applicationId ? updated : current,
      );
    },
    [applications],
  );

  const handleApproveApplication = React.useCallback(
    async (applicationId: string, closeAfter = false) => {
      try {
        await approveRecruitmentApplication(applicationId);
        updateHistoryApplicationStatus(applicationId, "approved");
        if (closeAfter) handleSetSelectedHistoryApp(null);
      } catch {
        // A ação do contexto já apresenta a mensagem adequada ao usuário.
      }
    },
    [approveRecruitmentApplication, updateHistoryApplicationStatus],
  );

  const handleRejectApplication = React.useCallback(
    async (applicationId: string, closeAfter = false) => {
      try {
        await rejectRecruitmentApplication(applicationId);
        updateHistoryApplicationStatus(applicationId, "rejected");
        if (closeAfter) handleSetSelectedHistoryApp(null);
      } catch {
        // A ação do contexto já apresenta a mensagem adequada ao usuário.
      }
    },
    [rejectRecruitmentApplication, updateHistoryApplicationStatus],
  );

  const handleDeleteApplication = React.useCallback(
    async (applicationId: string) => {
      try {
        await deleteRecruitmentApplication(applicationId);
        setHistoryApplications((current) =>
          current.filter((application) => application.id !== applicationId),
        );
        setAppToDelete(null);
      } catch {
        // Mantém a confirmação aberta para permitir nova tentativa.
      }
    },
    [deleteRecruitmentApplication],
  );

  const getCandidateProfile = (app: RecruitmentApplication): CandidateProfile =>
    candidateProfiles[app.id] ??
    usersById.get(app.userId || "") ??
    usersByEmail.get(app.email.trim().toLowerCase()) ??
    null;

  const getCandidatePhotoCandidates = (
    app: RecruitmentApplication,
  ): string[] =>
    Array.from(
      new Set([
        candidatePhotoUrls[app.id],
        ...getRecruitmentPhotoCandidates(app, getCandidateProfile(app)),
      ].filter((value): value is string => Boolean(value))),
    );

  // Hydrate legacy storage paths and fetch a pending applicant's canonical
  // profile document when it is not yet part of the company-scoped users list.
  // This is read-only: it does not rewrite applications during rendering.
  useEffect(() => {
    let cancelled = false;

    const hydrateCandidatePhotos = async () => {
      const pendingLookups = applications.filter((app) => {
        if (candidatePhotoUrls[app.id]) return false;
        const profile = getCandidateProfile(app);
        const profileLookupCompleted = Object.prototype.hasOwnProperty.call(
          candidateProfiles,
          app.id,
        );
        if (profileLookupCompleted) return false;
        const hasStoragePhoto =
          getRecruitmentPhotoStorageCandidates(app, profile).length > 0;
        return Boolean(
          hasStoragePhoto ||
            (app.userId && !profile && !profileLookupCompleted),
        );
      });

      if (pendingLookups.length === 0) return;

      const resolved = await Promise.all(
        pendingLookups.map(async (app) => {
          let profile = getCandidateProfile(app);

          if (!profile && app.userId) {
            try {
              const userDoc = await getDoc(doc(db, "users", app.userId));
              profile = userDoc.exists() ? userDoc.data() : null;
            } catch (error) {
              console.debug(
                "[Recruitment] Não foi possível ler o perfil do candidato:",
                app.id,
                error,
              );
            }
          }

          let photo = resolveRecruitmentPhoto(app, profile);
          if (!photo) {
            for (const path of getRecruitmentPhotoStorageCandidates(
              app,
              profile,
            )) {
              try {
                photo = await getDownloadURL(storageRef(storage, path));
                if (photo) break;
              } catch (error) {
                console.debug(
                  "[Recruitment] Foto armazenada não encontrada:",
                  app.id,
                  error,
                );
              }
            }
          }

          return { id: app.id, profile, photo };
        }),
      );

      if (cancelled) return;

      setCandidateProfiles((current) => {
        const next = { ...current };
        for (const item of resolved) next[item.id] = item.profile;
        return next;
      });
      setCandidatePhotoUrls((current) => {
        const next = { ...current };
        for (const item of resolved) {
          if (item.photo) next[item.id] = item.photo;
        }
        return next;
      });
    };

    void hydrateCandidatePhotos();
    return () => {
      cancelled = true;
    };
  }, [applications, candidatePhotoUrls, candidateProfiles, usersByEmail, usersById]);

  const filterFn = (app: RecruitmentApplication) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      app.fullName.toLowerCase().includes(term) ||
      app.email.toLowerCase().includes(term) ||
      (app.whatsapp && app.whatsapp.toLowerCase().includes(term)) ||
      (app.objective && app.objective.toLowerCase().includes(term))
    );
  };

  const pendingApps = applications
    .filter((a) => a.status === "pending" && a.isCurrent !== false && filterFn(a))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  const historyApps = applications
    .filter((a) => (a.status !== "pending" || a.isCurrent === false) && filterFn(a))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  // Quick action for auto save text area blurring
  const handleBlurSave = () => {
    handleSaveSettings();
  };

  const handleToggleHR = async () => {
    if (!activeCompanyId) return;
    const newIsActive = !settingsForm.isActive;
    setSettingsForm((prev) => ({ ...prev, isActive: newIsActive }));
    
    // Save immediately
    try {
      await updateRecruitmentSettings(activeCompanyId, {
        ...settingsForm,
        isActive: newIsActive,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      alert("Erro ao alterar o status.");
      // Revert on error
      setSettingsForm((prev) => ({ ...prev, isActive: !newIsActive }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mt-2">
        <p className="text-[13px] text-gray-500 dark:text-[#a1a1aa] font-medium text-center sm:text-left leading-normal w-full sm:w-auto">
          Gerencie novos candidatos<br />e a página de recrutamento.
        </p>

        <div className="flex items-center gap-2.5 bg-white dark:bg-[#1A1F26] px-3 py-1.5 rounded-xl border border-gray-200 dark:border-[#2A2F3A] shadow-sm w-full sm:w-auto">
          <div className="flex flex-col text-left sm:text-right flex-1 sm:flex-none">
            <span className="text-[12px] font-bold text-gray-900 dark:text-[#fafafa] leading-none mb-1">
              Portal de Vagas
            </span>
            <span className={`text-[10px] font-medium leading-none ${settingsForm.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>
              {settingsForm.isActive ? "Aberto para inscrições" : "Fechado"}
            </span>
          </div>
          
          <div className="h-6 w-[1px] bg-gray-100 dark:bg-[#2A2F3A] mx-0.5"></div>

          <button
            type="button"
            onClick={handleToggleHR}
            className={`relative inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              settingsForm.isActive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-[#3f3f46]'
            }`}
            role="switch"
            aria-checked={settingsForm.isActive}
          >
            <span className="sr-only">Ativar recrutamento</span>
            <span
              className={`pointer-events-none inline-block h-[20px] w-[20px] transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                settingsForm.isActive ? 'translate-x-[20px]' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-gray-100 dark:border-[#2A2F3A] mt-4">
        <button
          onClick={() => setActiveTab("candidates")}
          className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === "candidates" ? "text-indigo-600" : "text-gray-500 dark:text-[#a1a1aa] hover:text-gray-700 dark:hover:text-[#d4d4d8]"}`}
        >
          <div className="flex items-center gap-2 px-1">
            <Users2 size={16} /> Candidatos
            {pendingApps.length > 0 && (
              <span className="bg-rose-100 text-rose-600 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center justify-center">
                {pendingApps.length}
              </span>
            )}
          </div>
          {activeTab === "candidates" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("page")}
          className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === "page" ? "text-indigo-600" : "text-gray-500 dark:text-[#a1a1aa] hover:text-gray-700 dark:hover:text-[#d4d4d8]"}`}
        >
          <div className="flex items-center gap-2 px-1">
            <LayoutTemplate size={16} /> Página Física
          </div>
          {activeTab === "page" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full" />
          )}
        </button>
      </div>

      {/* Content */}
      {activeTab === "candidates" && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 mt-2">
          <div className="flex items-center">
            <div className="relative w-full sm:w-80">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar candidatos..."
                className="w-full bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] shadow-sm dark:shadow-none rounded-lg pl-9 pr-4 py-1.5 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-all text-sm outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <h3 className="font-semibold text-gray-900 dark:text-[#fafafa] border-b border-gray-100 dark:border-[#2A2F3A] pb-2 text-sm">
              Aguardando Avaliação ({pendingApps.length})
            </h3>
            {pendingApps.length === 0 ? (
              <div className="bg-gray-50 dark:bg-[#1A1F26] rounded-xl p-6 text-center text-gray-500 dark:text-[#a1a1aa] border border-gray-100 dark:border-[#2A2F3A] text-sm">
                Nenhum candidato aguardando aprovação no momento.
              </div>
            ) : (
              <div className="space-y-2">
                {pendingApps.map((app) => {
                  return (
                    <div
                      key={app.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-white dark:bg-[#1A1F26] rounded-lg border border-gray-200 dark:border-[#2A2F3A] shadow-sm dark:shadow-none cursor-pointer hover:border-indigo-200 hover:shadow-md dark:shadow-none transition-all gap-4"
                      onClick={() => handleSetSelectedHistoryApp(app)}
                    >
                      <div className="flex items-center gap-3 w-full sm:w-auto overflow-hidden">
                        <CandidateAvatar
                          name={app.fullName}
                          srcCandidates={getCandidatePhotoCandidates(app)}
                          wrapperClassName="w-9 h-9 rounded-full border border-gray-100 dark:border-[#2A2F3A] shrink-0"
                        />
                        <div className="min-w-0 pr-2">
                          <p className="font-medium text-gray-900 dark:text-[#fafafa] text-[13px] truncate">
                            {app.fullName}
                          </p>
                          <div className="items-center text-[11px] text-gray-500 dark:text-[#a1a1aa] truncate flex gap-1">
                            <Clock size={10} className="shrink-0" />{" "}
                            <span className="truncate">
                              Há {getTimeSince(app.createdAt)} &middot;{" "}
                              {app.email}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-50 dark:border-[#2A2F3A] mt-1 sm:mt-0 px-1 sm:px-0">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-700 border border-amber-200 dark:border-amber-500/30/60 uppercase tracking-widest shrink-0">
                          <Clock size={10} className="mr-1" /> Pendente
                        </span>
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetSelectedHistoryApp(app);
                          }}
                          className="bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] text-gray-700 dark:text-[#d4d4d8] hover:text-indigo-600 hover:bg-indigo-50 dark:bg-indigo-500/10 hover:border-indigo-200 dark:border-indigo-500/30 py-1 px-3 h-auto text-[11px] font-semibold flex-shrink-0"
                        >
                          Avaliar
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 mt-6">
            <h3 className="font-semibold text-gray-900 dark:text-[#fafafa] border-b border-gray-100 dark:border-[#2A2F3A] pb-2 text-sm">
              Histórico Recente
            </h3>
            {historyLoading && historyApps.length === 0 ? (
              <div className="bg-gray-50 dark:bg-[#1A1F26] rounded-xl p-6 text-center text-gray-500 dark:text-[#a1a1aa] border border-gray-100 dark:border-[#2A2F3A] text-sm">
                <Loader2 size={18} className="mx-auto mb-2 animate-spin" />
                Carregando histórico...
              </div>
            ) : historyApps.length === 0 ? (
              <div className="bg-gray-50 dark:bg-[#1A1F26] rounded-xl p-6 text-center text-gray-500 dark:text-[#a1a1aa] border border-gray-100 dark:border-[#2A2F3A] text-sm">
                Nenhum histórico disponível.
              </div>
            ) : (
              <div className="space-y-2">
                {historyApps.map((app) => {
                  return (
                    <div
                      key={app.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-white dark:bg-[#1A1F26] rounded-lg border border-gray-200 dark:border-[#2A2F3A] shadow-sm dark:shadow-none cursor-pointer hover:border-gray-300 dark:border-[#52525b] transition-all gap-4"
                      onClick={() => handleSetSelectedHistoryApp(app)}
                    >
                      <div className="flex items-center gap-3 w-full sm:w-auto overflow-hidden">
                        <CandidateAvatar
                          name={app.fullName}
                          srcCandidates={getCandidatePhotoCandidates(app)}
                          muted
                          wrapperClassName="w-9 h-9 rounded-full border border-gray-100 dark:border-[#2A2F3A] shrink-0"
                        />
                        <div className="min-w-0 pr-2">
                          <p className="font-medium text-gray-900 dark:text-[#fafafa] text-[13px] truncate">
                            {app.fullName}
                          </p>
                          <div className="items-center text-[11px] text-gray-500 dark:text-[#a1a1aa] truncate flex gap-1">
                            <Clock size={10} className="shrink-0" />{" "}
                            <span className="truncate">
                              Há {getTimeSince(app.createdAt)} &middot;{" "}
                              {app.email}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-50 dark:border-[#2A2F3A] mt-1 sm:mt-0 px-1 sm:px-0">
                        {app.status === "approved" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60 uppercase tracking-widest shrink-0">
                            <CheckCircle2 size={10} className="mr-1" /> Aprovado
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200/60 uppercase tracking-widest shrink-0">
                            <XCircle size={10} className="mr-1" /> Recusado
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAppToDelete(app.id);
                          }}
                          className="p-1 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded flex-shrink-0"
                          title="Excluir"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {historyHasMore && (
              <Button
                type="button"
                onClick={() => void loadRecruitmentHistory(false)}
                disabled={historyLoading}
                className="mt-1 w-full bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] text-gray-700 dark:text-[#d4d4d8] hover:bg-gray-50 dark:hover:bg-[#27272a] shadow-none"
              >
                {historyLoading ? (
                  <>
                    <Loader2 size={15} className="mr-2 animate-spin" />
                    Carregando...
                  </>
                ) : (
                  "Carregar mais histórico"
                )}
              </Button>
            )}
          </div>
        </div>
      )}

      {activeTab === "page" && (
        <div className="animate-in fade-in slide-in-from-bottom-2">
          <Card className="rounded-3xl border-gray-200 dark:border-[#2A2F3A] shadow-sm dark:shadow-none">
            <CardContent className="p-6 sm:p-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-[#fafafa]">
                    Editor da Página Pública
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-[#a1a1aa] mt-1">
                    Configure os textos da página que novos concorrentes verão
                    antes de preencher o formulário.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {saveSuccess && (
                    <span className="text-emerald-500 text-sm font-medium flex items-center animate-in fade-in">
                      <CheckCircle2 size={16} className="mr-1" /> Salvo com
                      sucesso!
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2 border-l-2 border-indigo-500 pl-3">
                  <label className="flex items-center gap-1.5 font-semibold text-gray-900 dark:text-[#fafafa] text-sm">
                    <FileText size={16} className="text-indigo-500" /> Sobre a
                    Empresa
                  </label>
                  <textarea
                    className="w-full bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] rounded-lg p-3 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-all text-sm min-h-[100px] shadow-sm dark:shadow-none resize-none"
                    placeholder="Somos a logística XYZ... (Markdown)"
                    value={settingsForm.about}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        about: e.target.value,
                      }))
                    }
                    onBlur={handleBlurSave}
                  />
                </div>

                <div className="space-y-2 border-l-2 border-rose-500 pl-3">
                  <label className="flex items-center gap-1.5 font-semibold text-gray-900 dark:text-[#fafafa] text-sm">
                    <Target size={16} className="text-rose-500" /> Regras da
                    Empresa
                  </label>
                  <textarea
                    className="w-full bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] rounded-lg p-3 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-all text-sm min-h-[100px] shadow-sm dark:shadow-none resize-none"
                    placeholder="1. Respeito obrigatório... (Markdown)"
                    value={settingsForm.rules}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        rules: e.target.value,
                      }))
                    }
                    onBlur={handleBlurSave}
                  />
                </div>

                <div className="space-y-2 border-l-2 border-sky-500 pl-3">
                  <label className="flex items-center gap-1.5 font-semibold text-gray-900 dark:text-[#fafafa] text-sm">
                    <Users2 size={16} className="text-sky-500" /> Como Funciona
                  </label>
                  <textarea
                    className="w-full bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] rounded-lg p-3 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-all text-sm min-h-[100px] shadow-sm dark:shadow-none resize-none"
                    placeholder="As entregas deverão ser logadas... (Markdown)"
                    value={settingsForm.howItWorks}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        howItWorks: e.target.value,
                      }))
                    }
                    onBlur={handleBlurSave}
                  />
                </div>

                <div className="space-y-2 border-l-2 border-emerald-500 pl-3">
                  <label className="flex items-center gap-1.5 font-semibold text-gray-900 dark:text-[#fafafa] text-sm">
                    <CheckCircle2 size={16} className="text-emerald-500" />{" "}
                    Benefícios
                  </label>
                  <textarea
                    className="w-full bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] rounded-lg p-3 focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-all text-sm min-h-[100px] shadow-sm dark:shadow-none resize-none"
                    placeholder="Comboios quinzenais... (Markdown)"
                    value={settingsForm.benefits}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        benefits: e.target.value,
                      }))
                    }
                    onBlur={handleBlurSave}
                  />
                </div>

                <div className="md:col-span-2 pt-2 flex justify-end">
                  <Button
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 h-auto text-sm shadow-sm dark:shadow-none font-semibold rounded-lg"
                  >
                    {isSavingSettings ? (
                      "Salvando..."
                    ) : (
                      <>
                        <Save size={16} className="mr-2" /> Salvar Alterações
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {selectedHistoryApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1A1F26] rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-[#2A2F3A]">
              <div className="flex items-center gap-3">
                <CandidateAvatar
                  name={selectedHistoryApp.fullName}
                  srcCandidates={getCandidatePhotoCandidates(selectedHistoryApp)}
                  wrapperClassName="w-12 h-12 rounded-full shadow-sm dark:shadow-none bg-gray-50 dark:bg-[#1A1F26] border border-gray-100 dark:border-[#2A2F3A]"
                />
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-[#fafafa] leading-tight">
                    {selectedHistoryApp.fullName}
                  </h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {selectedHistoryApp.status === "pending" && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-700 border border-amber-200 dark:border-amber-500/30/50">
                        {selectedHistoryApp.isCurrent === false ? "Substituída" : "Pendente"}
                      </span>
                    )}
                    {selectedHistoryApp.status === "approved" && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/50">
                        Aprovado
                      </span>
                    )}
                    {selectedHistoryApp.status === "rejected" && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200/50">
                        Recusado
                      </span>
                    )}
                    <span className="text-[11px] text-gray-500 dark:text-[#a1a1aa] font-medium tracking-wide">
                      &middot; Há {getTimeSince(selectedHistoryApp.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleSetSelectedHistoryApp(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-[#d4d4d8] dark:hover:text-[#a1a1aa] hover:bg-gray-100 dark:bg-[#27272a] dark:hover:bg-[#3f3f46]/50 rounded-lg transition-colors self-start shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 pb-8 space-y-5 bg-gray-50 dark:bg-[#1A1F26]">
              {/* Contato e Jogo */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white dark:bg-[#1A1F26] p-3.5 rounded-xl border border-gray-100 dark:border-[#2A2F3A] shadow-sm dark:shadow-none flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-gray-500 dark:text-[#a1a1aa]">
                    <Mail size={14} />
                    <p className="text-[11px] font-semibold uppercase tracking-wider">
                      Email
                    </p>
                  </div>
                  <p
                    className="text-[13px] font-medium text-gray-900 dark:text-[#fafafa] truncate"
                    title={selectedHistoryApp.email}
                  >
                    {selectedHistoryApp.email}
                  </p>
                </div>
                <div className="bg-white dark:bg-[#1A1F26] p-3.5 rounded-xl border border-gray-100 dark:border-[#2A2F3A] shadow-sm dark:shadow-none flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-gray-500 dark:text-[#a1a1aa]">
                    <Phone size={14} />
                    <p className="text-[11px] font-semibold uppercase tracking-wider">
                      WhatsApp
                    </p>
                  </div>
                  <p
                    className="text-[13px] font-medium text-gray-900 dark:text-[#fafafa] truncate"
                    title={selectedHistoryApp.whatsapp}
                  >
                    {selectedHistoryApp.whatsapp}
                  </p>
                </div>
                <div className="bg-white dark:bg-[#1A1F26] p-3.5 rounded-xl border border-gray-100 dark:border-[#2A2F3A] shadow-sm dark:shadow-none flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-gray-500 dark:text-[#a1a1aa]">
                    <Gamepad2 size={14} />
                    <p className="text-[11px] font-semibold uppercase tracking-wider">
                      Simulador
                    </p>
                  </div>
                  <p className="text-[13px] font-medium text-gray-900 dark:text-[#fafafa] truncate">
                    {activeCompany?.simulatorName || "-"}
                  </p>
                </div>
              </div>

              {/* Informações Operacionais */}
              <div className="bg-white dark:bg-[#1A1F26] rounded-xl border border-gray-100 dark:border-[#2A2F3A] shadow-sm dark:shadow-none">
                <div className="px-4 py-3 border-b border-gray-50 dark:border-[#2A2F3A] flex items-center gap-2">
                  <Target
                    size={14}
                    className="text-indigo-600 dark:text-indigo-400"
                  />
                  <h3 className="font-semibold text-gray-900 dark:text-[#fafafa] text-[13px]">
                    Informações Operacionais
                  </h3>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-6">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-[#a1a1aa] uppercase tracking-widest mb-1">
                      Objetivo Logístico
                    </p>
                    <p className="text-[13px] text-gray-900 dark:text-[#fafafa] font-medium">
                      {selectedHistoryApp.objective}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-[#a1a1aa] uppercase tracking-widest mb-1">
                      Margem de Viagens
                    </p>
                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-gray-900 dark:text-[#fafafa]">
                      <Clock size={14} className="text-gray-400" />{" "}
                      {selectedHistoryApp.deliveriesPerWeek}{" "}
                      <span className="text-gray-500 dark:text-[#a1a1aa] text-xs font-normal">
                        viagens/semana
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-[#a1a1aa] uppercase tracking-widest mb-1">
                      Veículo Principal
                    </p>
                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-gray-900 dark:text-[#fafafa]">
                      <Car size={14} className="text-gray-400" />{" "}
                      {selectedHistoryApp.primaryVehicle}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-[#a1a1aa] uppercase tracking-widest mb-1">
                      Veículo Secundário
                    </p>
                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-gray-900 dark:text-[#fafafa]">
                      <Car size={14} className="text-gray-400 opacity-50" />{" "}
                      {selectedHistoryApp.secondaryVehicle || (
                        <span className="text-gray-400 font-normal italic">
                          Nenhum
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="sm:col-span-2 pt-2">
                    <div className="bg-slate-50 dark:bg-[#18181b] p-3 rounded-lg border border-slate-100 dark:border-[#2A2F3A]">
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-[#a1a1aa] uppercase tracking-widest mb-1.5">
                        Experiência Prévia
                      </p>
                      <p className="text-[13px] text-slate-900 dark:text-[#fafafa] font-medium">
                        {selectedHistoryApp.hasExperience
                          ? "Sim, possui experiência com outras empresas (VTC)."
                          : "Não, primeira vez operando de forma organizada."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Análise do Candidato */}
              <div className="bg-white dark:bg-[#1A1F26] rounded-xl border border-indigo-100 dark:border-indigo-500/30 shadow-sm dark:shadow-none relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-50 dark:bg-indigo-500"></div>
                <div className="px-5 py-4">
                  <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-wider mb-2">
                    Por que devemos aprovar sua inscrição?
                  </p>
                  <p className="text-[13px] text-gray-800 dark:text-[#d4d4d8] italic leading-relaxed">
                    "{selectedHistoryApp.reason}"
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Footer / Actions */}
            <div className="p-4 border-t border-gray-100 dark:border-[#2A2F3A] bg-white dark:bg-[#1A1F26] flex flex-col sm:flex-row gap-2">
              {selectedHistoryApp.status === "pending" && selectedHistoryApp.isCurrent !== false ? (
                <>
                  <Button
                    onClick={() => {
                      void handleRejectApplication(
                        selectedHistoryApp.id,
                        true,
                      );
                    }}
                    className="w-full sm:w-1/2 bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] text-gray-700 dark:text-[#fafafa] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 py-2 h-auto text-sm shadow-sm dark:shadow-none"
                  >
                    <XCircle size={16} className="mr-2" /> Recusar Inscrição
                  </Button>
                  <Button
                    onClick={() => {
                      void handleApproveApplication(
                        selectedHistoryApp.id,
                        true,
                      );
                    }}
                    className="w-full sm:w-1/2 bg-emerald-600 hover:bg-emerald-700 text-white py-2 h-auto text-sm shadow-sm dark:shadow-none"
                  >
                    <CheckCircle2 size={16} className="mr-2" /> Aprovar
                    Inscrição
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    onClick={() => handleSetSelectedHistoryApp(null)}
                    className="w-full sm:w-1/3 bg-gray-50 dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] text-gray-700 dark:text-[#fafafa] hover:bg-gray-100 dark:hover:bg-[#27272a] py-2 h-auto text-sm"
                  >
                    Fechar
                  </Button>
                  {selectedHistoryApp.status === "rejected" && (
                    <>
                      <div className="flex-1">
                        <Button
                          onClick={() => {
                            void handleApproveApplication(
                              selectedHistoryApp.id,
                            );
                          }}
                          className="w-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 py-2 h-auto border-none text-sm"
                        >
                          <CheckCircle2 size={16} className="mr-2" /> Mudar para
                          Aprovado
                        </Button>
                      </div>
                      <div className="flex-none">
                        <Button
                          onClick={() => {
                            setAppToDelete(selectedHistoryApp.id);
                            handleSetSelectedHistoryApp(null);
                          }}
                          className="w-full bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 py-2 h-auto border-none"
                          title="Excluir do Histórico"
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </>
                  )}
                  {selectedHistoryApp.status === "approved" && (
                    <>
                      <div className="flex-1">
                        <Button
                          onClick={() => {
                            void handleRejectApplication(
                              selectedHistoryApp.id,
                            );
                          }}
                          className="w-full bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 py-2 h-auto border-none text-sm"
                        >
                          <XCircle size={16} className="mr-2" /> Revogar
                          Aprovação
                        </Button>
                      </div>
                      <div className="flex-none">
                        <Button
                          onClick={() => {
                            setAppToDelete(selectedHistoryApp.id);
                            handleSetSelectedHistoryApp(null);
                          }}
                          className="w-full bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 py-2 h-auto border-none"
                          title="Excluir do Histórico"
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {appToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1A1F26] rounded-2xl w-full max-w-sm overflow-hidden flex flex-col shadow-xl animate-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-[#fafafa] mb-2">
                Excluir Inscrição
              </h3>
              <p className="text-sm text-gray-500 dark:text-[#a1a1aa]">
                Tem certeza que deseja excluir esta inscrição do histórico? Esta
                ação não pode ser desfeita.
              </p>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-[#1A1F26] flex gap-3">
              <Button
                onClick={() => setAppToDelete(null)}
                className="flex-1 bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] text-gray-700 dark:text-[#d4d4d8] hover:bg-gray-100 dark:hover:bg-[#3f3f46]/50 font-semibold"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  if (appToDelete) {
                    void handleDeleteApplication(appToDelete);
                  }
                }}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold"
              >
                Excluir
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(AdminRecruitment);
