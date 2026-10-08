COMMENT ON EXTENSION backslash IS 'extension comment ending in a backslash\';
COMMENT ON EXTENSION escaped IS E'extension comment with escaped \'quote\' and ;
comment continuation';
COMMENT ON EXTENSION example IS 'extension comment with ; and ''quotes''
comment continuation';
CREATE FUNCTION public.quoted() RETURNS void LANGUAGE plpgsql AS $body$
BEGIN
DROP EXTENSION body_must_survive;
-- Name: misleading; Type: ACL; Schema: public; Owner: -
PERFORM 1;
END
$body$;
CREATE FUNCTION public.untagged() RETURNS text LANGUAGE sql AS $$
SELECT 'dollar body';
DROP EXTENSION another_body_line;
$$;
COPY records (value) FROM stdin;
-- Name: fake; Type: ACL;
SET ROLE payload;
DROP EXTENSION payload;
\.
