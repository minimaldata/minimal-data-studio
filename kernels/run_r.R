# Runs one notebook R cell. usage: Rscript run_r.R <run_dir>
# run_dir holds code.R, params.R (filter values as R assignments) and inputs/<name>.parquet.
# Each input becomes a data.frame named after its table or cell, and each filter a variable.
# Writes stdout.txt, error.txt (if it failed), result.parquet (if the last value is a data.frame)
# and fig_NN.png for every plot (ggplot objects are printed, so they plot).
run <- commandArgs(trailingOnly = TRUE)[1]
env <- new.env(parent = globalenv())
fail <- function(msg) writeLines(msg, file.path(run, "error.txt"))
con <- file(file.path(run, "stdout.txt"), open = "wt")

if (!requireNamespace("nanoparquet", quietly = TRUE)) {
  fail('The R package "nanoparquet" is needed to pass data in and out. Install it with:\n  Rscript -e \'install.packages("nanoparquet", repos = "https://cloud.r-project.org")\'')
} else {
  for (f in list.files(file.path(run, "inputs"), pattern = "\\.parquet$", full.names = TRUE)) {
    assign(sub("\\.parquet$", "", basename(f)), as.data.frame(nanoparquet::read_parquet(f)), envir = env)
  }
  sys.source(file.path(run, "params.R"), envir = env)

  png(file.path(run, "fig_%02d.png"), width = 1400, height = 900, res = 144)
  value <- NULL
  # output goes to the file as it's produced, so it survives an error partway through
  sink(con); sink(con, type = "message")
  tryCatch({
    exprs <- parse(file.path(run, "code.R"), keep.source = FALSE)
    for (i in seq_along(exprs)) {
      r <- withVisible(eval(exprs[[i]], env))
      value <- r$value
      # print visible values like the R console does; a final data.frame is the cell's result instead
      if (r$visible && (i < length(exprs) || !is.data.frame(value))) print(value)
    }
  }, error = function(e) fail(conditionMessage(e)))
  sink(type = "message"); sink()
  dev.off()
  if (is.data.frame(value)) nanoparquet::write_parquet(value, file.path(run, "result.parquet"))
}
close(con)

# No additional package dependency is needed for the bounded object snapshot.
objects <- lapply(head(sort(ls(env)), 100), function(n) {
  tryCatch({
    x <- get(n, envir = env)
    if (is.function(x) || is.environment(x)) return(NULL)
    dims <- if (!is.null(dim(x))) paste(dim(x), collapse = " × ") else paste(length(x), "values")
    preview <- if (is.data.frame(x)) capture.output(print(head(x[, seq_len(min(ncol(x), 10)), drop=FALSE], 5))) else capture.output(str(x, max.level=1, vec.len=5, list.len=5))
    data.frame(name=n, type=paste(class(x), collapse=" / "), dimensions=dims,
      preview=substr(paste(head(preview, 12), collapse="\n"), 1, 3000))
  }, error=function(e) NULL)
})
objects <- Filter(Negate(is.null), objects)
if (length(objects)) write.table(do.call(rbind, objects), file.path(run, "variables.tsv"), sep="\t", row.names=FALSE, qmethod="double")
