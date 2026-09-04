#!/usr/bin/env python
# Compatibility wrapper for the pre-rename helper name.
import os
import runpy
runpy.run_path(os.path.join(os.path.dirname(__file__), 'upsun-fake-rpc.py'), run_name='__main__')
