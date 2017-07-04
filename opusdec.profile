blacklist /usr/local/bin
blacklist /usr/bin
blacklist /bin
blacklist /sbin
blacklist /boot
blacklist /media
blacklist /mnt
blacklist /opt
blacklist /var
blacklist /tmp
blacklist /home
blacklist /app

private-bin opusdec

shell none
seccomp.keep access,arch_prctl,brk,clone,close,connect,execve,exit_group,fchmod,fchown,fcntl,fstat,getdents,getuid,ioctl,lseek,mmap,mprotect,munmap,nanosleep,open,openat,read,rt_sigaction,set_robust_list,setresgid,setresuid,socket,stat,unshare,wait4,write
caps.drop all
net none
noroot
nosound
novideo
nogroups
nonewprivs
