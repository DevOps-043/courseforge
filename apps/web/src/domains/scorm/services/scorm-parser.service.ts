import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { ScormManifest, ScormOrganization, ScormResource, ScormItem } from '../types';

export class ScormParserService {

  async parsePackage(zipBuffer: Buffer): Promise<ScormManifest> {
    const zip = await JSZip.loadAsync(zipBuffer);

    // 1. Search for imsmanifest.xml in root
    const manifestFile = zip.file('imsmanifest.xml');
    if (!manifestFile) {
      throw new Error('Invalid SCORM package: imsmanifest.xml not found in root');
    }

    // 2. Parse XML
    const xmlContent = await manifestFile.async('string');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    });
    const parsed = parser.parse(xmlContent);
    const manifest = parsed.manifest;

    if (!manifest) {
      throw new Error('Invalid SCORM manifest: Root <manifest> element not found');
    }

    // 3. Detect version
    const version = this.detectScormVersion(manifest);

    // 4. Extract structure
    const organizations = this.extractOrganizations(manifest);
    const resources = this.extractResources(manifest);

    return {
      version,
      title: organizations[0]?.title || 'Untitled Course',
      organizations,
      resources
    };
  }

  private detectScormVersion(manifest: any): '1.2' | '2004' {
    const schemaVersion = manifest.metadata?.schemaversion;
    // Simple check, can be improved
    if (typeof schemaVersion === 'string' && schemaVersion.includes('2004')) {
      return '2004';
    }
    // Check namespace if needed, but default to 1.2 for now or if schemaversion missing/1.2
    return '1.2';
  }

  private extractOrganizations(manifest: any): ScormOrganization[] {
    const orgs = manifest.organizations?.organization;
    if (!orgs) return [];

    const orgList = Array.isArray(orgs) ? orgs : [orgs];

    return orgList.map((org: any) => ({
      identifier: org['@_identifier'],
      title: this.getNodeText(org.title),
      items: this.extractItems(org.item)
    }));
  }

  private extractItems(items: any): ScormItem[] {
    if (!items) return [];
    const itemList = Array.isArray(items) ? items : [items];

    return itemList.map((item: any) => ({
      identifier: item['@_identifier'],
      title: this.getNodeText(item.title),
      resourceRef: item['@_identifierref'],
      parameters: item['@_parameters'],
      children: this.extractItems(item.item)
    }));
  }

  private extractResources(manifest: any): ScormResource[] {
    const res = manifest.resources?.resource;
    if (!res) return [];

    const resList = Array.isArray(res) ? res : [res];

    return resList.map((r: any) => {
      const fileNodes = r.file;
      let files: string[] = [];
      if (fileNodes) {
        const fileList = Array.isArray(fileNodes) ? fileNodes : [fileNodes];
        files = fileList.map((f: any) => f['@_href']).filter(Boolean);
      }

      return {
        identifier: r['@_identifier'],
        type: r['@_adlcp:scormtype'] === 'sco' ? 'sco' : 'asset', // This attribute might vary by version
        href: r['@_href'],
        files
      };
    });
  }

  private getNodeText(node: any): string {
    if (typeof node === 'string') return node;
    return node?.['#text'] || '';
  }
}
