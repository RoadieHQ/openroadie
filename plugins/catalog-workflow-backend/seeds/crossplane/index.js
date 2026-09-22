/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const { k8sListSeed, crdInstanceSeed } = require('./helpers');

module.exports = [
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane composite resource definitions',
    description:
      'List CompositeResourceDefinitions (XRDs) in the cluster. Each XRD defines a platform API and optionally a namespaced claim type.',
    path: '/apis/apiextensions.crossplane.io/v1/compositeresourcedefinitions',
    listNodeId: 'list-xrds',
    label: 'List XRDs',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane compositions',
    description:
      'List Compositions in the cluster. Compositions map composite resources onto managed resources or a function pipeline.',
    path: '/apis/apiextensions.crossplane.io/v1/compositions',
    listNodeId: 'list-compositions',
    label: 'List compositions',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane composition revisions',
    description:
      'List CompositionRevisions in the cluster. Each revision is an immutable snapshot of a Composition.',
    path: '/apis/apiextensions.crossplane.io/v1/compositionrevisions',
    listNodeId: 'list-composition-revisions',
    label: 'List composition revisions',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane providers',
    description:
      'List Provider packages in the cluster. Providers install managed resource CRDs and their controllers.',
    path: '/apis/pkg.crossplane.io/v1/providers',
    listNodeId: 'list-providers',
    label: 'List providers',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane provider revisions',
    description:
      'List ProviderRevisions in the cluster. Each revision is an installed version of a Provider package.',
    path: '/apis/pkg.crossplane.io/v1/providerrevisions',
    listNodeId: 'list-provider-revisions',
    label: 'List provider revisions',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane functions',
    description:
      'List Function packages in the cluster. Functions run as steps in Composition pipelines.',
    path: '/apis/pkg.crossplane.io/v1/functions',
    listNodeId: 'list-functions',
    label: 'List functions',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane function revisions',
    description:
      'List FunctionRevisions in the cluster. Each revision is an installed version of a Function package.',
    path: '/apis/pkg.crossplane.io/v1/functionrevisions',
    listNodeId: 'list-function-revisions',
    label: 'List function revisions',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane configurations',
    description:
      'List Configuration packages in the cluster. Configurations bundle XRDs, Compositions, and related resources.',
    path: '/apis/pkg.crossplane.io/v1/configurations',
    listNodeId: 'list-configurations',
    label: 'List configurations',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane configuration revisions',
    description:
      'List ConfigurationRevisions in the cluster. Each revision is an installed version of a Configuration package.',
    path: '/apis/pkg.crossplane.io/v1/configurationrevisions',
    listNodeId: 'list-configuration-revisions',
    label: 'List configuration revisions',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane deployment runtime configs',
    description:
      'List DeploymentRuntimeConfigs in the cluster. These configure how Provider and Function packages run.',
    path: '/apis/pkg.crossplane.io/v1beta1/deploymentruntimeconfigs',
    listNodeId: 'list-deployment-runtime-configs',
    label: 'List deployment runtime configs',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane environment configs',
    description:
      'List EnvironmentConfigs in the cluster. These supply extra data to Compositions.',
    path: '/apis/apiextensions.crossplane.io/v1beta1/environmentconfigs',
    listNodeId: 'list-environment-configs',
    label: 'List environment configs',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane managed resource definitions',
    description:
      'List ManagedResourceDefinitions in the cluster. Each MRD describes a managed resource API a Provider can serve.',
    path: '/apis/apiextensions.crossplane.io/v1alpha1/managedresourcedefinitions',
    listNodeId: 'list-managed-resource-definitions',
    label: 'List managed resource definitions',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane usages',
    description:
      'List Usages across all namespaces. Usages block deletion of resources that still have dependents.',
    path: '/apis/protection.crossplane.io/v1beta1/usages',
    listNodeId: 'list-usages',
    label: 'List usages',
  }),
  k8sListSeed({
    frequencyValue: 12,
    name: 'Crossplane image configs',
    description:
      'List ImageConfigs in the cluster. ImageConfigs rewrite and verify package image references.',
    path: '/apis/pkg.crossplane.io/v1beta1/imageconfigs',
    listNodeId: 'list-image-configs',
    label: 'List image configs',
  }),
  crdInstanceSeed({
    frequencyValue: 1,
    name: 'Crossplane claims',
    description:
      'List claim instances by discovering CRDs in the claim category, then listing each kind cluster-wide.',
    predicate: 'spec.names.categories[$ = "claim"]',
    label: 'List claims per CRD',
  }),
  crdInstanceSeed({
    frequencyValue: 1,
    name: 'Crossplane composite resources',
    description:
      'List composite resource instances by discovering CRDs in the composite category, then listing each kind cluster-wide.',
    predicate: 'spec.names.categories[$ = "composite"]',
    label: 'List composite resources per CRD',
  }),
  crdInstanceSeed({
    frequencyValue: 1,
    name: 'Crossplane managed resources',
    description:
      'List managed resource instances by discovering CRDs in the managed category, then listing each kind cluster-wide.',
    predicate: 'spec.names.categories[$ = "managed"]',
    label: 'List managed resources per CRD',
  }),
  crdInstanceSeed({
    frequencyValue: 1,
    name: 'Crossplane provider configs',
    description:
      'List ProviderConfig and ClusterProviderConfig instances by discovering matching CRDs, then listing each kind cluster-wide.',
    predicate:
      'spec.names.kind = "ProviderConfig" or spec.names.kind = "ClusterProviderConfig"',
    label: 'List provider configs per CRD',
  }),
];
