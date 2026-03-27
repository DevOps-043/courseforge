import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { ScormManifest, ScormOrganization, ScormResource, ScormItem } from '../types';

type XmlTextNode = string | { '#text'?: string } | undefined;

interface ManifestXmlNode {
  metadata?: {
    schemaversion?: string;
  };
  organizations?: {
    organization?: OrganizationXmlNode | OrganizationXmlNode[];
  };
  resources?: {
    resource?: ResourceXmlNode | ResourceXmlNode[];
  };
}

interface OrganizationXmlNode {
  '@_identifier': string;
  title?: XmlTextNode;
  item?: ItemXmlNode | ItemXmlNode[];
}

interface ItemXmlNode {
  '@_identifier': string;
  '@_identifierref'?: string;
  '@_parameters'?: string;
  item?: ItemXmlNode | ItemXmlNode[];
  title?: XmlTextNode;
}

interface ResourceFileXmlNode {
  '@_href'?: string;
}

interface ResourceXmlNode {
  '@_adlcp:scormtype'?: string;
  '@_href': string;
  '@_identifier': string;
  file?: ResourceFileXmlNode | ResourceFileXmlNode[];
}

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
    const parsed = parser.parse(xmlContent) as { manifest?: ManifestXmlNode };
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

  private detectScormVersion(manifest: ManifestXmlNode): '1.2' | '2004' {
    const schemaVersion = manifest.metadata?.schemaversion;
    // Simple check, can be improved
    if (typeof schemaVersion === 'string' && schemaVersion.includes('2004')) {
      return '2004';
    }
    // Check namespace if needed, but default to 1.2 for now or if schemaversion missing/1.2
    return '1.2';
  }

  private extractOrganizations(manifest: ManifestXmlNode): ScormOrganization[] {
    const orgs = manifest.organizations?.organization;
    if (!orgs) return [];

    const orgList = Array.isArray(orgs) ? orgs : [orgs];

    return orgList.map((org) => ({
      identifier: org['@_identifier'],
      title: this.getNodeText(org.title),
      items: this.extractItems(org.item)
    }));
  }

  private extractItems(items?: ItemXmlNode | ItemXmlNode[]): ScormItem[] {
    if (!items) return [];
    const itemList = Array.isArray(items) ? items : [items];

    return itemList.map((item) => ({
      identifier: item['@_identifier'],
      title: this.getNodeText(item.title),
      resourceRef: item['@_identifierref'],
      parameters: item['@_parameters'],
      children: this.extractItems(item.item)
    }));
  }

  private extractResources(manifest: ManifestXmlNode): ScormResource[] {
    const res = manifest.resources?.resource;
    if (!res) return [];

    const resList = Array.isArray(res) ? res : [res];

    return resList.map((resource) => {
      const fileNodes = resource.file;
      let files: string[] = [];
      if (fileNodes) {
        const fileList = Array.isArray(fileNodes) ? fileNodes : [fileNodes];
        files = fileList
          .map((fileNode) => fileNode['@_href'])
          .filter((href): href is string => Boolean(href));
      }

      return {
        identifier: resource['@_identifier'],
        type: resource['@_adlcp:scormtype'] === 'sco' ? 'sco' : 'asset', // This attribute might vary by version
        href: resource['@_href'],
        files
      };
    });
  }

  private getNodeText(node: XmlTextNode): string {
    if (typeof node === 'string') return node;
    return node?.['#text'] || '';
  }
}
