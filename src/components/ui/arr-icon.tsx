import Image from "next/image";
import {cn} from "@/lib/utils";

export type ArrIconType =
    | "sonarr"
    | "radarr"
    | "lidarr"
    | "readarr"
    | "listenarr"
    | "prowlarr";

const SRC: Record<ArrIconType, string> = {
    sonarr: "/arr/sonarr.svg",
    radarr: "/arr/radarr.svg",
    lidarr: "/arr/lidarr.svg",
    readarr: "/arr/readarr.svg",
    listenarr: "/arr/listenarr.svg",
    prowlarr: "/arr/prowlarr.svg",
};

const LABEL: Record<ArrIconType, string> = {
    sonarr: "Sonarr",
    radarr: "Radarr",
    lidarr: "Lidarr",
    readarr: "Readarr",
    listenarr: "Listenarr",
    prowlarr: "Prowlarr",
};

interface ArrIconProps {
    type: ArrIconType;
    size?: number;
    className?: string;
    decorative?: boolean;
}

export function ArrIcon({
                            type,
                            size = 16,
                            className,
                            decorative = false,
                        }: ArrIconProps) {
    return (
        <Image
            src={SRC[type]}
            alt={decorative ? "" : LABEL[type]}
            aria-hidden={decorative ? true : undefined}
            width={size}
            height={size}
            className={cn("inline-block shrink-0", className)}
            unoptimized
            priority={false}
        />
    );
}
