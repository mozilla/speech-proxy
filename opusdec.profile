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

private-bin opusdec

noexec /home
noexec /tmp

shell none
seccomp
caps.drop all
net none
noroot
nosound
nogroups
nonewprivs
ipc-namespace
