/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_BASE_URL?: string;
	readonly VITE_COCO_ENABLE_TASK_AUTHORING?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
