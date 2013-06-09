#include "ActorParser.h"

ActorParser::ActorParser()
{
    //ctor
}

ActorParser::~ActorParser()
{
    //dtor
}

    bool ActorParser::parserNewStruct(TCODParser *parser,const TCODParserStruct *str,const char *name) {
        printf ("new structure type '%s' with name '%s'\n",str->getName(),name ? name : "NULL");
        return true;
    }
    bool ActorParser::parserFlag(TCODParser *parser,const char *name) {
        printf ("found new flag '%s'\n",name);
        return true;
    }
    bool ActorParser::parserProperty(TCODParser *parser,const char *name, TCOD_value_type_t type, TCOD_value_t value) {
        printf ("found new property '%s'\n",name);
        return true;
    }
    bool ActorParser::parserEndStruct(TCODParser *parser,const TCODParserStruct *str,const char *name) {
        printf ("end of structure type '%s'\n",name);
        return true;
    }
    void ActorParser::error(const char *msg) {
        fprintf(stderr,msg);
        exit(1);
    }
