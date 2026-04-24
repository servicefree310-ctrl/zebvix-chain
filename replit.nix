{pkgs}: {
  deps = [
    pkgs.llvmPackages.libclang
    pkgs.clang
  ];
}
