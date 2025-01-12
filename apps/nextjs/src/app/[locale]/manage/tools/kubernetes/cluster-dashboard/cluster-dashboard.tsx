"use client";

import { Badge, Group, SimpleGrid, Skeleton, Stack, Title } from "@mantine/core";
import { IconLabel } from "@tabler/icons-react";

import { clientApi } from "@homarr/api/client";
import { useI18n } from "@homarr/translation/client";

import KubernetesErrorPage from "~/app/[locale]/manage/tools/kubernetes/cluster-dashboard/error";
import { HeaderCard } from "~/app/[locale]/manage/tools/kubernetes/cluster-dashboard/header-card/header-card";
import { ResourceGauge } from "~/app/[locale]/manage/tools/kubernetes/cluster-dashboard/resource-gauge/resource-gauge";

export function ClusterDashboard() {
  const t = useI18n();
  const { data, isLoading, isError } = clientApi.kubernetes.getCluster.useQuery();

  if (isError) {
    return (
      <Stack bg="var(--mantine-color-body)">
        <Title>{t("kubernetes.cluster.title")}</Title>
        <KubernetesErrorPage />
      </Stack>
    );
  }

  return (
    <>
      <Stack bg="var(--mantine-color-body)">
        <Group justify="space-between">
          <Title>{t("kubernetes.cluster.title")}</Title>
          <Badge leftSection={<IconLabel size={24} />} variant="light" color="blue" size="xl" radius="md">
            {data ? data.name : ""}
          </Badge>
        </Group>

        <SimpleGrid cols={3}>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} visible={true} height={65} />)
          ) : (
            <>
              <HeaderCard headerType={"providers"} value={data ? data.providers : ""} />
              <HeaderCard headerType={"version"} value={data ? data.kubernetesVersion : ""} />
              <HeaderCard headerType={"architecture"} value={data ? data.architecture : ""} />
            </>
          )}
        </SimpleGrid>

        <Title>{t("kubernetes.cluster.capacity.title")}</Title>

        <SimpleGrid cols={3}>
          {isLoading
            ? Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} visible={true} height={200} />)
            : data?.capacity.map((capacity) => <ResourceGauge kubernetesCapacity={capacity} key={capacity.type} />)}
        </SimpleGrid>
      </Stack>
    </>
  );
}
