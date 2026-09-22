export function stripScopeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('scope')) {
    return;
  }

  url.searchParams.delete('scope');
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}
