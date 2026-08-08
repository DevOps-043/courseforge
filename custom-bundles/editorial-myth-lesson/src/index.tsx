import React from "react";
import { Composition, registerRoot } from "remotion";
import { compositionConfig } from "./composition";

function RemotionRoot() {
  return <Composition {...compositionConfig} />;
}

registerRoot(RemotionRoot);
