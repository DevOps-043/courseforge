export interface ScormManifest {
    version: '1.2' | '2004';
    title: string;
    organizations: ScormOrganization[];
    resources: ScormResource[];
}

export interface ScormOrganization {
    identifier: string;
    title: string;
    items: ScormItem[];
}

export interface ScormItem {
    identifier: string;
    title: string;
    resourceRef?: string;    // identifierref
    parameters?: string;     // URL parameters
    children: ScormItem[];   // nested items
}

export interface ScormResource {
    identifier: string;
    type: 'sco' | 'asset';
    href: string;
    files: string[];
}

export interface ScormAnalysisResult {
    manifest: ScormManifest;
    scoCount: number;
    totalSize: number;
}
