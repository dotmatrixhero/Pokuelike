#include "ParserListener.h"

/**
** This class is a wrapper for the libtcod's text and configuration file parser.
**/

    ParserListener::ParserListener(){

    }

    ParserListener::~ParserListener(){}

    bool ParserListener::parserNewStruct(TCODParser *parser,const TCODParserStruct *str,const char *name) {
        printf ("new structure type '%s' with name '%s'\n",str->getName(),name ? name : "NULL");
        return true;
    }
    bool ParserListener::parserFlag(TCODParser *parser,const char *name) {
        printf ("found new flag '%s'\n",name);
        return true;
    }
    bool ParserListener::parserProperty(TCODParser *parser,const char *name, TCOD_value_type_t type, TCOD_value_t value) {
        printf ("found new property '%s'\n",name);
        return true;
    }
    bool ParserListener::parserEndStruct(TCODParser *parser,const TCODParserStruct *str,const char *name) {
        printf ("end of structure type '%s'\n",name);
        return true;
    }
    void ParserListener::error(const char *msg) {
        fprintf(stderr,msg);
        exit(1);
    }
