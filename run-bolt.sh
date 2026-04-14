#!/bin/bash
cd /home/micah/Github/coreline-v2
exec claude --permission-mode bypassPermissions --print "$(cat BOLT_TASK.md)"
