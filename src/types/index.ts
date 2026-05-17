// Shared domain types for PKCS#12 Converter.
// Used by both main (Node) and renderer (Vue) via preload bridge.

export type Fingerprint = {
  sha1: string;
  sha256: string;
};

export type CertificateInfo = {
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  signatureAlgorithm: string;
  subjectAltNames: string[];
  subjectKeyIdentifier?: string;
  authorityKeyIdentifier?: string;
  fingerprint: Fingerprint;
};

export type PrivateKeyAlgorithm = "RSA" | "EC" | "DSA" | "ED25519" | "UNKNOWN";

export type PrivateKeyInfo = {
  algorithm: PrivateKeyAlgorithm;
  keySize: number;
  encrypted: boolean;
  subjectKeyIdentifier?: string;
};

export type InputKind = "pfx" | "keyUnencrypted" | "keyEncrypted" | "unknown";

export type DetectInputTypeResult = {
  kind: InputKind;
  reason?: string;
};

export type KeyViewResult = {
  privateKey: PrivateKeyInfo;
};

export type ViewKeyRequest = {
  keyFile: string;
};

export type Pkcs12EncryptionInfo = {
  scheme: string;
  kdf?: string;
  cipher?: string;
  iterationCount?: number;
  prf?: string;
};

export type Pkcs12BagKind = "key" | "cert" | "other";

export type Pkcs12BagInfo = {
  kind: Pkcs12BagKind;
  friendlyName?: string;
  localKeyId?: string;
};

export type Pkcs12Generation = "modern" | "legacy" | "mixed" | "unknown";

export type Pkcs12StructureInfo = {
  macAlgorithm?: string;
  macIterationCount?: number;
  keyEncryption?: Pkcs12EncryptionInfo;
  certEncryption?: Pkcs12EncryptionInfo;
  bags: Pkcs12BagInfo[];
  generation: Pkcs12Generation;
};

export type Pkcs12ViewResult = {
  privateKey?: PrivateKeyInfo;
  serverCert?: CertificateInfo;
  chainCerts: CertificateInfo[];
  structure?: Pkcs12StructureInfo;
};

export type WarningCode =
  | "CHAIN_REORDERED"
  | "CHAIN_HAS_EXTRA_CERTS"
  | "CHAIN_HAS_DUPLICATE_CERTS"
  | "CHAIN_HAS_ANCHOR"
  | "CHAIN_NOT_LINKED"
  | "LEGACY_MODE_UNCERTAIN"
  | "JKS_MULTIPLE_ALIASES"
  | "PKCS12_MULTIPLE_ALIASES";

export type OperationWarning = {
  code: WarningCode;
  message: string;
  requiresConfirmation: boolean;
  details?: Record<string, unknown>;
};

export type DroppedCertReason = "duplicate" | "unrelated";

export type DroppedCert = {
  reason: DroppedCertReason;
  cert: CertificateInfo;
  sourceFile: string;
};

export type NormalizedChainCert = {
  cert: CertificateInfo;
  sourceFile: string;
};

export type MergePrecheckResult = {
  precheckToken: string;
  keyMatchesCert: boolean;
  normalizedChainCerts: NormalizedChainCert[];
  droppedChainCerts: DroppedCert[];
  anchorCert?: CertificateInfo;
};

export type OperationResult<T = unknown> = {
  success: boolean;
  message: string;
  details?: T;
  warnings?: OperationWarning[];
  requiresConfirmation?: boolean;
  outputFiles?: string[];
};

// === IPC Requests ===

export type Pkcs12Algorithm = "AES-256-CBC" | "PBE-SHA1-3DES";

export type LegacyMode = "auto" | "on" | "off";

export type CertOutputMode = "merged" | "split";

export type MergePrecheckRequest = {
  privateKeyFile: string;
  privateKeyPassword?: string;
  serverCertFile: string;
  chainCertFiles: string[];
};

export type MergeRequest = MergePrecheckRequest & {
  precheckToken: string;
  confirmedWarningCodes: WarningCode[];
  exportPassword: string;
  algorithm: Pkcs12Algorithm;
  outputFile: string;
};

export type ExtractRequest = {
  pfxFile: string;
  pfxPassword: string;
  outputDir: string;
  certOutputMode: CertOutputMode;
  legacyMode: LegacyMode;
};

export type ViewRequest = {
  pfxFile: string;
  pfxPassword: string;
  legacyMode?: LegacyMode;
};

export type OpenFileDialogRequest = {
  filters?: Array<{ name: string; extensions: string[] }>;
  multiSelect?: boolean;
  title?: string;
};

export type SaveFileDialogRequest = {
  filters?: Array<{ name: string; extensions: string[] }>;
  defaultName?: string;
  title?: string;
};

export type OpenDirectoryDialogRequest = {
  title?: string;
  defaultPath?: string;
};

// === JKS ↔ P12 conversion (M2) ===

export type ListAliasesRequest = {
  keystoreFile: string;
  keystorePassword: string;
  storeType: "JKS" | "PKCS12";
};

export type AliasEntryType =
  | "PrivateKeyEntry"
  | "TrustedCertEntry"
  | "SecretKeyEntry"
  | "Unknown";

export type AliasEntry = {
  alias: string;
  entryType: AliasEntryType;
};

export type JksToP12Request = {
  jksFile: string;
  jksPassword: string;
  outputFile: string;
  outputPassword: string;
  aliasFilter?: string;
};

export type P12ToJksRequest = {
  pfxFile: string;
  pfxPassword: string;
  outputFile: string;
  outputPassword: string;
  aliasFilter?: string;
};
