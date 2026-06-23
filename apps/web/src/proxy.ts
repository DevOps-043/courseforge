import { NextRequest, NextResponse } from "next/server";

interface UserOrganizationCookie {
  id: string;
  role?: string;
  slug: string;
}

const LEGACY_APP_SEGMENTS = new Set(["admin", "architect", "builder"]);
const PUBLIC_FILE_PATTERN = /\.[^/]+$/;

function parseOrganizationsCookie(request: NextRequest) {
  const rawOrganizations = request.cookies.get("cf_user_orgs")?.value;
  if (!rawOrganizations) return [];

  try {
    const parsed = JSON.parse(rawOrganizations) as UserOrganizationCookie[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildTenantRedirectPath(
  request: NextRequest,
  organization: UserOrganizationCookie,
) {
  const { pathname, search } = request.nextUrl;
  return `/${organization.slug}${pathname}${search}`;
}

function getActiveOrganization(
  request: NextRequest,
  organizations: UserOrganizationCookie[],
) {
  const activeOrgId = request.cookies.get("cf_active_org")?.value;
  return (
    organizations.find((organization) => organization.id === activeOrgId) ||
    organizations[0] ||
    null
  );
}

function shouldSkipProxy(pathname: string) {
  return (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/privacy") ||
    pathname === "/" ||
    PUBLIC_FILE_PATTERN.test(pathname)
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (shouldSkipProxy(pathname)) {
    return NextResponse.next();
  }

  const pathSegments = pathname.split("/").filter(Boolean);
  const [firstSegment, secondSegment] = pathSegments;
  const organizations = parseOrganizationsCookie(request);

  if (LEGACY_APP_SEGMENTS.has(firstSegment || "")) {
    const activeOrganization = getActiveOrganization(request, organizations);
    if (!activeOrganization) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    return NextResponse.redirect(
      new URL(buildTenantRedirectPath(request, activeOrganization), request.url),
    );
  }

  if (firstSegment && LEGACY_APP_SEGMENTS.has(secondSegment || "")) {
    const organization = organizations.find(
      (candidate) => candidate.slug === firstSegment,
    );

    if (!organization) {
      const activeOrganization = getActiveOrganization(request, organizations);
      if (!activeOrganization) {
        return NextResponse.redirect(new URL("/login", request.url));
      }

      const legacyPath = `/${pathSegments.slice(1).join("/")}`;
      return NextResponse.redirect(
        new URL(
          `/${activeOrganization.slug}${legacyPath}${request.nextUrl.search}`,
          request.url,
        ),
      );
    }

    const response = NextResponse.next();
    const activeOrgId = request.cookies.get("cf_active_org")?.value;
    if (activeOrgId !== organization.id) {
      response.cookies.set("cf_active_org", organization.id, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    }

    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
