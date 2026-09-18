import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../lib/firebase";

type SeniorAccessResponse = {
  success: boolean;
  role: "senior";
  tokenRefreshRequired: boolean;
};

export async function authenticateSeniorAccess(
  password: string,
): Promise<SeniorAccessResponse> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    throw new Error("Entre com sua conta Google antes de acessar o Painel Sênior.");
  }

  const callable = httpsCallable<
    { password: string },
    SeniorAccessResponse
  >(functions, "authenticateSeniorAccess");
  const response = await callable({ password });

  // A Function acabou de gravar o claim no Firebase Auth. A atualização
  // forçada evita exigir logout/login para que Rules reconheçam a permissão.
  await firebaseUser.getIdToken(true);
  const token = await firebaseUser.getIdTokenResult();
  if (token.claims.senior !== true) {
    throw new Error("A permissão Sênior ainda não foi confirmada pelo Firebase.");
  }

  return response.data;
}
