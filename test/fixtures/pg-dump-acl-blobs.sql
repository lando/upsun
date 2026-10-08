-- PostgreSQL database dump

-- Data for Name: example; Type: TABLE DATA; Schema: public; Owner: -
COPY public.example (value) FROM stdin;
BEGIN;
COMMIT;
GRANT SELECT ON TABLE public.example TO copy_reader;
-- Name: x; Type: ACL;
\.

-- Name: TABLE example; Type: ACL; Schema: public; Owner: -
GRANT SELECT ON TABLE public.example TO remote_reader;
REVOKE ALL ON TABLE public.example FROM remote_owner;

-- Data for Name: BLOBS; Type: BLOBS; Schema: -; Owner: -
BEGIN;
SELECT pg_catalog.lo_open('9001', 131072);
SELECT pg_catalog.lowrite(0, '\xcafe');
SELECT pg_catalog.lo_close(0);
COMMIT;

-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
ALTER DEFAULT PRIVILEGES FOR ROLE remote_owner IN SCHEMA public GRANT SELECT ON TABLES TO remote_reader;

-- Name: TABLE example; Type: COMMENT; Schema: public; Owner: -
COMMENT ON TABLE public.example IS 'kept after ACL sections';
