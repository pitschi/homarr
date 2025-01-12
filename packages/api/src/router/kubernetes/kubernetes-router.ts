import type { V1NodeList, VersionInfo } from "@kubernetes/client-node";
import * as k8s from "@kubernetes/client-node";
import { KubeConfig, Metrics } from "@kubernetes/client-node";
import { TRPCError } from "@trpc/server";

import type { KubernetesCluster, KubernetesNode, KubernetesNodeState } from "@homarr/definitions";
import { logger } from "@homarr/log";

import { createTRPCRouter, permissionRequiredProcedure } from "../../trpc";
import { ResourceParserFactory } from "./resource-parser/resource-parser-factory";

export const kubernetesRouter = createTRPCRouter({
  getNodes: permissionRequiredProcedure.requiresPermission("admin").query(async (): Promise<KubernetesNode[]> => {
    const kc = new KubeConfig();
    kc.loadFromDefault();

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    try {
      const nodes = await k8sApi.listNode();

      return nodes.items.map((node) => {
        // Extract node name
        const name = node.metadata?.name || "unknown";

        // Determine node readiness status
        const readyCondition = node.status?.conditions?.find((condition) => condition.type === "Ready");
        const status: KubernetesNodeState = readyCondition?.status === "True" ? "Ready" : "NotReady";

        // Extract CPU cores
        const cpuRaw = node.status?.capacity?.cpu || "0";
        const cpuCores = cpuRaw.includes("m") ? parseInt(cpuRaw) / 1000 : parseInt(cpuRaw);

        // Extract and convert RAM (from Ki to GB)
        const memoryRaw = node.status?.capacity?.memory || "0";
        const memoryKi = parseInt(memoryRaw.replace("Ki", "")) || 0;
        const ramGB = memoryKi / 1024 / 1024; // Convert KiB to GiB

        // Extract Kubernetes version (from kubelet version)
        const kubeletVersion = node.status?.nodeInfo?.kubeletVersion || "unknown";
        const kubernetesVersion = kubeletVersion.startsWith("v") ? kubeletVersion.substring(1) : kubeletVersion;

        // Extract agent version (additional information if available)
        const agentVersion = node.status?.nodeInfo?.containerRuntimeVersion || "unknown";

        // Extract the last heartbeat time
        const lastHeartbeatTime = readyCondition?.lastHeartbeatTime || "unknown";

        return {
          name,
          status,
          ramGB: parseFloat(ramGB.toFixed(2)),
          cpuCores,
          agentVersion,
          kubernetesVersion,
          lastHeartbeatTime,
        };
      });
    } catch (error) {
      logger.error(error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "An error occurred while fetching Kubernetes nodes",
        cause: error,
      });
    }
  }),

  getCluster: permissionRequiredProcedure.requiresPermission("admin").query(async (): Promise<KubernetesCluster> => {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const versionApi = kc.makeApiClient(k8s.VersionApi);

    try {
      const metricsClient = new Metrics(kc);
      const nodeMetricsClient = await metricsClient.getNodeMetrics();
      const versionInfo = await versionApi.getCode();

      const nodes = await k8sApi.listNode();

      let totalCPUCapacity = 0;
      let totalCPUAllocatable = 0;
      let totalCPUUsage = 0;

      let totalMemoryCapacity = 0;
      let totalMemoryAllocatable = 0;
      let totalMemoryUsage = 0;

      let totalCapacityPods = 0;

      const cpuParser = ResourceParserFactory.getParser("cpu");
      const MemoryParser = ResourceParserFactory.getParser("memory");

      const listPodForAllNamespaces = await k8sApi.listPodForAllNamespaces();

      nodes.items.map((node) => {
        totalCapacityPods += Number(node.status?.capacity?.pods) || 0;

        const cpuCapacity = cpuParser.parse(node.status?.capacity?.cpu || "0");
        const cpuAllocatable = cpuParser.parse(node.status?.allocatable?.cpu || "0");
        totalCPUCapacity += cpuCapacity;
        totalCPUAllocatable += cpuAllocatable;

        const memoryCapacity = MemoryParser.parse(node.status?.capacity?.memory || "0");
        const memoryAllocatable = MemoryParser.parse(node.status?.allocatable?.memory || "0");
        totalMemoryCapacity += memoryCapacity;
        totalMemoryAllocatable += memoryAllocatable;

        const nodeName = node.metadata?.name;
        const nodeMetric = nodeMetricsClient.items.find((m) => m.metadata.name === nodeName);
        if (nodeMetric) {
          const cpuUsage = cpuParser.parse(nodeMetric.usage.cpu);
          totalCPUUsage += cpuUsage;

          const memoryUsage = MemoryParser.parse(nodeMetric.usage.memory);
          totalMemoryUsage += memoryUsage;
        }
      });

      const reservedCPU = totalCPUCapacity - totalCPUAllocatable;
      const reservedMemory = totalMemoryCapacity - totalMemoryAllocatable;

      const reservedCPUPercentage = (reservedCPU / totalCPUCapacity) * 100;
      const reservedMemoryPercentage = (reservedMemory / totalMemoryCapacity) * 100;

      const usagePercentageAllocatable = (totalCPUUsage / totalCPUAllocatable) * 100;
      const usagePercentageMemoryAllocatable = (totalMemoryUsage / totalMemoryAllocatable) * 100;

      const usedPodsPercentage = (listPodForAllNamespaces.items.length / totalCapacityPods) * 100;

      return {
        name: kc.getCurrentContext(),
        providers: getProviders(versionInfo, nodes) || "Unknown",
        kubernetesVersion: versionInfo.gitVersion,
        architecture: versionInfo.platform,
        nodeCount: nodes.items.length,
        capacity: [
          {
            type: "CPU",
            resourcesStats: [
              {
                percentageValue: Number(reservedCPUPercentage.toFixed(2)),
                type: "Reserved",
                capacityUnit: "Cores",
                usedValue: Number(reservedCPU.toFixed(2)),
                maxUsedValue: Number(totalCPUCapacity.toFixed(2)),
              },
              {
                percentageValue: Number(usagePercentageAllocatable.toFixed(2)),
                type: "Used",
                capacityUnit: "Cores",
                usedValue: Number(totalCPUUsage.toFixed(2)),
                maxUsedValue: Number(totalCPUAllocatable.toFixed(2)),
              },
            ],
          },
          {
            type: "Memory",
            resourcesStats: [
              {
                percentageValue: Number(reservedMemoryPercentage.toFixed(2)),
                type: "Reserved",
                capacityUnit: "GiB",
                usedValue: Number(reservedMemory.toFixed(2)),
                maxUsedValue: Number(totalMemoryCapacity.toFixed(2)),
              },
              {
                percentageValue: Number(usagePercentageMemoryAllocatable.toFixed(2)),
                type: "Used",
                capacityUnit: "GiB",
                usedValue: Number(totalMemoryUsage.toFixed(2)),
                maxUsedValue: Number(totalMemoryAllocatable.toFixed(2)),
              },
            ],
          },
          {
            type: "Pods",
            resourcesStats: [
              {
                percentageValue: Number(usedPodsPercentage.toFixed(2)),
                type: "Used",
                usedValue: listPodForAllNamespaces.items.length,
                maxUsedValue: totalCapacityPods,
              },
            ],
          },
        ],
      };
    } catch (error) {
      logger.error(error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "An error occurred while fetching Kubernetes cluster",
        cause: error,
      });
    }
  }),
});

function getProviders(versionInfo: VersionInfo, nodes: V1NodeList) {
  const providers = new Set<string>();

  if (versionInfo.gitVersion.includes("k3s")) providers.add("k3s");
  if (versionInfo.gitVersion.includes("gke")) providers.add("GKE");
  if (versionInfo.gitVersion.includes("eks")) providers.add("EKS");
  if (versionInfo.gitVersion.includes("aks")) providers.add("AKS");

  nodes.items.forEach((node) => {
    const nodeProviderLabel =
      node.metadata?.labels?.["node.kubernetes.io/instance-type"] || node.metadata?.labels?.provider || "";
    if (nodeProviderLabel.includes("aws")) providers.add("EKS");
    if (nodeProviderLabel.includes("azure")) providers.add("AKS");
    if (nodeProviderLabel.includes("gce")) providers.add("GKE");
    if (nodeProviderLabel.includes("k3s")) providers.add("k3s");
  });

  return Array.from(providers).join(", ");
}
