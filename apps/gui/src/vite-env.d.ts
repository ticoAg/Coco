/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_AGENTMESH_ENABLE_TASK_AUTHORING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
