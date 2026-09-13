/**
 * Erreurs d'API au format `{ error: { code, message } }` (§12).
 *
 * Les messages sont en français et destinés à être affichés : l'app est
 * mono-foyer et l'utilisateur est l'administrateur. Un « Bad Request » nu ne
 * l'aide en rien.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, code = 'requete_invalide'): ApiError {
    return new ApiError(400, code, message);
  }

  static unauthorized(message = 'session absente ou expirée'): ApiError {
    return new ApiError(401, 'non_authentifie', message);
  }

  static notFound(message = 'ressource introuvable'): ApiError {
    return new ApiError(404, 'introuvable', message);
  }

  toBody(): { error: { code: string; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}
