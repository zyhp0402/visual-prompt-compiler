# Evaluation artifacts

`eval:mock` and `eval:real` write one JSON report and one Markdown summary per run here.
`eval:cases:mock` writes the local case-retrieval A/B report here too.
Run outputs are intentionally ignored because they may contain environment-specific
metadata. Reports contain case IDs and aggregate metrics only; briefs, mandatory copy,
and generated prompts are not persisted.

Case-output similarity uses the maximum of character 3-gram Jaccard and
pattern-gram containment for each full/compact prompt, then aggregates the maximum
per direction. Exact summaries embedded in longer prompts therefore score 1.
The current deterministic run flags 18/30 retrieval directions and recommends
`remove`; this is an experiment recommendation only and does not delete code or
enable retrieval automatically.
